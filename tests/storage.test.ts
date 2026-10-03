import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  LocalStorageError,
  api,
  cacheSnapshot,
  cachedSnapshot,
  clearLocal,
  discardPending,
  enqueue,
  overlayPending,
  pending,
  pendingConflict,
  retryPending,
  storageWarning,
  syncQueue,
  waitForSync,
} from "../src/api";
import {
  scaleFood,
  totals,
  type FoodLog,
  type Snapshot,
} from "../shared/domain";
import {
  accountLifetime,
  accountBoundaryKey,
  AccountStorageError,
  beginAccountChange,
  startAccountLifetime,
  StaleAccountError,
} from "../src/accountLifecycle";

const userId = "0f60d60a-54a2-4d9d-9d25-22a62943518f";
const friendId = "f4ecf8e0-3433-4ac9-9ff1-6c8a75df4ac5";
const cacheKey = "bulkbro-cache";
const queueKey = "bulkbro-pending-v1";
const entry: FoodLog = {
  id: "20f161ff-b82e-4909-bd39-a4b9cf29e96a",
  name: "Oats",
  brand: "",
  serving: 100,
  unit: "g",
  calories: 300,
  protein: 20,
  carbs: 40,
  fat: 6,
  fibre: 1,
  source: "User entry",
  date: "2026-10-03",
  meal: "Breakfast",
};
const snapshot = (): Snapshot => ({
  user: { id: userId, email: "owner@example.test" },
  profile: null,
  foods: [],
  logs: [],
  weights: [],
  workouts: [],
  activity: [],
  savedMeals: [],
  favourites: [],
});
let stored: Map<string, string>;
let storage: Storage;
beforeEach(() => {
  stored = new Map();
  storage = {
    getItem: vi.fn((key: string) => stored.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      stored.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      stored.delete(key);
    }),
    clear: vi.fn(() => stored.clear()),
    key: vi.fn((index: number) => [...stored.keys()][index] ?? null),
    get length() {
      return stored.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  clearLocal();
});
afterEach(() => vi.unstubAllGlobals());

describe("honest local persistence", () => {
  it("rejects malformed server snapshots before replacing the visible diary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...snapshot(), logs: "damaged" }), {
            status: 200,
          }),
      ),
    );
    await expect(api("/snapshot")).rejects.toThrow(
      "account data could not be read safely",
    );
  });
  it.each(["{broken", "{}", '[{"id":"malformed"}]'])(
    "preserves malformed queued data (%s) and refuses to overwrite it",
    (value) => {
      stored.set(queueKey, value);
      expect(pending()).toEqual([]);
      expect(storageWarning()).toContain("cannot be read");
      expect(() => enqueue(userId, "/logs", [entry])).toThrow(
        LocalStorageError,
      );
      expect(stored.get(queueKey)).toBe(value);
    },
  );
  it("validates every cached collection before allowing offline access", () => {
    for (const damaged of [
      { ...snapshot(), logs: ["invalid"] },
      { ...snapshot(), foods: [{ ...entry, calories: -1 }] },
      { ...snapshot(), workouts: {} },
      { ...snapshot(), savedMeals: null },
      { ...snapshot(), user: { id: "invalid", email: "owner@example.test" } },
    ]) {
      stored.set(cacheKey, JSON.stringify(damaged));
      expect(cachedSnapshot()).toBeNull();
      expect(storageWarning()).toContain("cannot be read");
      expect(stored.has(cacheKey)).toBe(true);
    }
  });
  it("does not claim an offline save when browser storage is full or blocked", () => {
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(cacheSnapshot(snapshot())).toBe(false);
    expect(() => enqueue(userId, "/logs", [entry])).toThrow("Not saved:");
    expect(pending()).toEqual([]);
    expect(cachedSnapshot()).toBeNull();
  });
  it("can load the app while storage reads are blocked, while reporting offline saving unavailable", () => {
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(pending()).toEqual([]);
    expect(cachedSnapshot()).toBeNull();
    expect(() => enqueue(userId, "/logs", [entry])).toThrow(LocalStorageError);
    expect(storageWarning()).toContain("cannot be read");
  });
  it("retains queued food corrections and deletions after reloading the snapshot", () => {
    cacheSnapshot(snapshot());
    enqueue(userId, "/logs", [{ ...entry, ...scaleFood(entry, 150) }]);
    expect(totals(overlayPending(cachedSnapshot()!).logs).calories).toBe(450);
    enqueue(
      userId,
      "/logs/" + entry.id,
      { ...entry, ...scaleFood(entry, 200) },
      "PUT",
    );
    expect(totals(overlayPending(cachedSnapshot()!).logs).calories).toBe(600);
    enqueue(userId, "/logs/" + entry.id, undefined, "DELETE");
    expect(overlayPending(cachedSnapshot()!).logs).toEqual([]);
    expect(pending()).toHaveLength(3);
  });
  it("only deletes the selected meal on its selected day", () => {
    const data = snapshot();
    data.logs = [
      entry,
      { ...entry, id: crypto.randomUUID(), meal: "Lunch" },
      { ...entry, id: crypto.randomUUID(), date: "2026-10-02" },
    ];
    enqueue(
      userId,
      "/logs?date=2026-10-03&meal=Breakfast",
      undefined,
      "DELETE",
    );
    expect(overlayPending(data).logs).toEqual(data.logs.slice(1));
  });
  it("retains an entry moved into a deleted meal when replaying an optimistic cache", () => {
    const lunch = { ...entry, id: crypto.randomUUID(), meal: "Lunch" };
    const data = { ...snapshot(), logs: [entry, lunch] };
    enqueue(
      userId,
      "/logs?date=2026-10-03&meal=Breakfast",
      undefined,
      "DELETE",
    );
    const moved = { ...lunch, meal: "Breakfast", ...scaleFood(lunch, 200) };
    enqueue(userId, "/logs/" + lunch.id, moved, "PUT");
    for (let reload = 0; reload < 3; reload++) {
      cacheSnapshot(overlayPending(reload === 0 ? data : cachedSnapshot()!));
      expect(cachedSnapshot()!.logs).toEqual([moved]);
      expect(totals(cachedSnapshot()!.logs).calories).toBe(600);
    }
  });
  it("replays inserts, meal deletion and a later insert idempotently", () => {
    const later = { ...entry, id: crypto.randomUUID(), name: "Later oats" };
    enqueue(userId, "/logs", [entry]);
    enqueue(
      userId,
      "/logs?date=2026-10-03&meal=Breakfast",
      undefined,
      "DELETE",
    );
    enqueue(userId, "/logs", [later]);
    const first = overlayPending(snapshot());
    expect(first.logs).toEqual([later]);
    expect(overlayPending(first)).toEqual(first);
    enqueue(userId, "/logs/" + later.id, undefined, "DELETE");
    const deleted = overlayPending(first);
    expect(deleted.logs).toEqual([]);
    expect(overlayPending(deleted)).toEqual(deleted);
  });
  it("clears cached account data and pending entries on logout", () => {
    cacheSnapshot(snapshot());
    enqueue(userId, "/logs", [entry]);
    clearLocal();
    expect(cachedSnapshot()).toBeNull();
    expect(pending()).toEqual([]);
    expect(storageWarning()).toBe("");
  });
});

describe("account-scoped offline replay", () => {
  it("can wait for active replay without starting a queued write", async () => {
    enqueue(userId, "/logs", [entry]);
    let respond!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await waitForSync(userId);
    expect(fetcher).not.toHaveBeenCalled();
    expect(pending()).toHaveLength(1);
    const replay = syncQueue(userId);
    let settled = false;
    const waiting = waitForSync(userId).then(() => {
      settled = true;
    });
    await waitForSync(friendId);
    expect(settled).toBe(false);
    respond(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await Promise.all([replay, waiting]);
    expect(settled).toBe(true);
    expect(pending()).toEqual([]);
  });
  it.each([400, 403, 404, 409])(
    "quarantines HTTP %s conflicts durably and continues unrelated writes",
    async (status) => {
      const correction = { ...entry, ...scaleFood(entry, 200) };
      const unrelated = { ...entry, id: crypto.randomUUID(), meal: "Lunch" };
      enqueue(userId, "/logs/" + entry.id, correction, "PUT");
      enqueue(userId, "/logs", [unrelated]);
      enqueue(userId, "/weights", {
        id: crypto.randomUUID(),
        date: entry.date,
        weight: 80,
      });
      const fetcher = vi.fn(async (path: string) =>
        path.endsWith(entry.id)
          ? new Response(JSON.stringify({ error: "Entry no longer exists" }), {
              status,
            })
          : new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetcher);
      await syncQueue(userId);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(pending()).toHaveLength(1);
      expect(pending()[0]).toMatchObject({
        body: correction,
        conflict: { status, message: "Entry no longer exists" },
      });
      expect(JSON.parse(stored.get(queueKey)!)[0].conflict.status).toBe(status);
      expect(overlayPending(snapshot()).logs).toEqual([correction]);
      expect(
        pendingConflict(userId, "/logs/" + entry.id, correction, "PUT")?.id,
      ).toBe(pending()[0].id);
      expect(pendingConflict(userId, "/logs", [unrelated])).toBeUndefined();
      expect(
        pendingConflict(friendId, "/logs/" + entry.id, correction, "PUT"),
      ).toBeUndefined();
      await syncQueue(userId);
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );
  it("keeps later changes to the conflicted record in order, then retries only for its owner", async () => {
    const later = { ...entry, ...scaleFood(entry, 200) };
    enqueue(userId, "/logs/" + entry.id, entry, "PUT");
    enqueue(userId, "/logs/" + entry.id, later, "PUT");
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Missing entry" }), {
          status: 404,
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await syncQueue(userId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const conflict = pending()[0];
    expect(pending()).toHaveLength(2);
    expect(pending()[1].conflict).toBeUndefined();
    await expect(retryPending(friendId, conflict.id)).rejects.toThrow(
      "no longer available",
    );
    expect(pending()[0].conflict).toBeDefined();
    fetcher.mockImplementation(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await retryPending(userId, conflict.id);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(requests[1][1].body as string).serving).toBe(100);
    expect(JSON.parse(requests[2][1].body as string).serving).toBe(200);
    expect(pending()).toEqual([]);
  });
  it("preserves transitive meal dependencies while replaying independent entries", async () => {
    const moved = { ...entry, meal: "Lunch" };
    const lunch = { ...entry, id: crypto.randomUUID(), meal: "Lunch" };
    const dinner = { ...entry, id: crypto.randomUUID(), meal: "Dinner" };
    enqueue(userId, "/logs/" + entry.id, moved, "PUT");
    enqueue(userId, "/logs?date=2026-10-03&meal=Lunch", undefined, "DELETE");
    enqueue(userId, "/logs", [lunch]);
    enqueue(userId, "/logs", [dinner]);
    const fetcher = vi.fn(async (path: string) =>
      path.endsWith(entry.id)
        ? new Response(JSON.stringify({ error: "Missing entry" }), {
            status: 404,
          })
        : new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await syncQueue(userId);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(pending()).toHaveLength(3);
    expect(pendingConflict(userId, "/logs", [lunch])?.id).toBe(pending()[0].id);
    expect(pendingConflict(userId, "/logs", [dinner])).toBeUndefined();
  });
  it("discards only the selected owner's operation and preserves dependent drafts", async () => {
    enqueue(userId, "/logs/" + entry.id, entry, "PUT");
    enqueue(
      userId,
      "/logs/" + entry.id,
      { ...entry, ...scaleFood(entry, 200) },
      "PUT",
    );
    enqueue(friendId, "/logs", [entry]);
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Missing entry" }), {
          status: 404,
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await syncQueue(userId);
    const conflict = pending()[0];
    const laterId = pending()[1].id;
    await expect(discardPending(friendId, conflict.id)).rejects.toThrow(
      "no longer available",
    );
    expect(pending()).toHaveLength(3);
    await discardPending(userId, conflict.id);
    expect(pending()).toHaveLength(2);
    expect(pending()[0].id).toBe(laterId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await syncQueue(userId);
    expect(pending()[0]).toMatchObject({
      id: laterId,
      conflict: { status: 404 },
    });
    await discardPending(userId, laterId);
    expect(pending()).toHaveLength(1);
    expect(pending()[0].userId).toBe(friendId);
  });
  it("fails honestly when it cannot persist conflict recovery state", async () => {
    enqueue(userId, "/logs/" + entry.id, entry, "PUT");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Missing entry" }), {
            status: 404,
          }),
      ),
    );
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await expect(syncQueue(userId)).rejects.toBeInstanceOf(LocalStorageError);
    expect(pending()).toHaveLength(1);
    expect(pending()[0].conflict).toBeUndefined();
  });
  it("keeps the conflict when retrying or discarding cannot update browser storage", async () => {
    enqueue(userId, "/logs/" + entry.id, entry, "PUT");
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Missing entry" }), {
          status: 404,
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await syncQueue(userId);
    const conflict = pending()[0];
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await expect(retryPending(userId, conflict.id)).rejects.toBeInstanceOf(
      LocalStorageError,
    );
    await expect(discardPending(userId, conflict.id)).rejects.toBeInstanceOf(
      LocalStorageError,
    );
    expect(pending()).toEqual([conflict]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 429, 500, 503])(
    "keeps HTTP %s failures retryable without quarantining or sending later writes",
    async (status) => {
      enqueue(userId, "/logs/" + entry.id, entry, "PUT");
      enqueue(userId, "/logs", [{ ...entry, id: crypto.randomUUID() }]);
      const fetcher = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Try again later" }), {
            status,
          }),
      );
      vi.stubGlobal("fetch", fetcher);
      await expect(syncQueue(userId)).rejects.toBeInstanceOf(ApiError);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(pending()).toHaveLength(2);
      expect(pending().every((item) => !item.conflict)).toBe(true);
    },
  );
  it("never overlays or sends another friend's entries", async () => {
    enqueue(userId, "/logs", [entry]);
    enqueue(friendId, "/logs", [
      { ...entry, id: crypto.randomUUID(), name: "Friend toast" },
    ]);
    expect(overlayPending(snapshot()).logs.map((food) => food.name)).toEqual([
      "Oats",
    ]);
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await syncQueue(userId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].headers).toMatchObject({ "X-Bulkbro-User": userId });
    expect(pending()).toHaveLength(1);
    expect(pending()[0].userId).toBe(friendId);
  });
  it.each([401, 503, 409])(
    "retains entries when sync fails with HTTP %s",
    async (status) => {
      enqueue(userId, "/logs", [entry]);
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ error: "Cannot sync", code: "ACCOUNT_CHANGED" }),
              { status },
            ),
        ),
      );
      await expect(syncQueue(userId)).rejects.toBeInstanceOf(ApiError);
      expect(pending()).toHaveLength(1);
    },
  );
  it("retains queued entries if a successful HTTP response is unreadable", async () => {
    enqueue(userId, "/logs", [entry]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>Proxy error</html>", { status: 200 }),
      ),
    );
    await expect(syncQueue(userId)).rejects.toThrow(
      "server response could not be read",
    );
    expect(pending()).toHaveLength(1);
  });
  it("serializes concurrent sync attempts for the same account", async () => {
    enqueue(userId, "/logs", [entry]);
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await Promise.all([syncQueue(userId), syncQueue(userId)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(pending()).toEqual([]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("account lifetime boundaries", () => {
  it("ordinary snapshot adoption does not publish a boundary to other tabs", () => {
    const marker = stored.get(accountBoundaryKey);
    vi.mocked(storage.setItem).mockClear();
    startAccountLifetime(userId);
    expect(stored.get(accountBoundaryKey)).toBe(marker);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(["success", "network failure"])(
    "rejects a peer tab's stale API %s before its storage event arrives",
    async (outcome) => {
      startAccountLifetime(userId);
      const lifetime = accountLifetime();
      const response = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => response.promise),
      );
      const request = api("/snapshot");
      const rejected =
        expect(request).rejects.toBeInstanceOf(StaleAccountError);
      // Simulate another browsing context publishing its marker, without delivering an event.
      stored.set(
        accountBoundaryKey,
        JSON.stringify({ id: crypto.randomUUID(), signedIn: false }),
      );
      expect(() => cacheSnapshot(snapshot(), lifetime)).toThrow(
        StaleAccountError,
      );
      expect(() => enqueue(userId, "/logs", [entry], "POST", lifetime)).toThrow(
        StaleAccountError,
      );
      if (outcome === "success")
        response.resolve(new Response(JSON.stringify(snapshot())));
      else response.reject(new TypeError("Network unavailable"));
      await rejected;
      expect(stored.has(cacheKey)).toBe(false);
      expect(stored.has(queueKey)).toBe(false);
    },
  );

  it("rejects a late replay after a peer publishes a new generation without waiting for an event", async () => {
    enqueue(userId, "/logs", [entry]);
    const response = deferred<Response>();
    const fetcher = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetcher);
    const replay = syncQueue(userId);
    const rejected = expect(replay).rejects.toBeInstanceOf(StaleAccountError);
    stored.set(
      accountBoundaryKey,
      JSON.stringify({ id: crypto.randomUUID(), signedIn: true }),
    );
    stored.set(queueKey, "[]");
    vi.mocked(storage.setItem).mockClear();
    response.resolve(
      new Response(JSON.stringify({ error: "Missing entry" }), { status: 404 }),
    );
    await rejected;
    expect(stored.get(queueKey)).toBe("[]");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps a usable local lifetime when boundary publication fails (removal blocked: %s)",
    (removalBlocked) => {
      cacheSnapshot(snapshot());
      const oldLifetime = accountLifetime();
      beginAccountChange();
      const marker = stored.get(accountBoundaryKey);
      vi.mocked(storage.setItem).mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
      if (removalBlocked)
        vi.mocked(storage.removeItem).mockImplementation(() => {
          throw new DOMException("Blocked", "SecurityError");
        });
      expect(() => clearLocal()).toThrow(AccountStorageError);
      expect(stored.get(accountBoundaryKey)).toBe(marker);
      expect(stored.has(cacheKey)).toBe(removalBlocked);
      expect(accountLifetime()).not.toBe(oldLifetime);
      expect(accountLifetime().changing).toBe(false);
      expect(accountLifetime().userId).toBeUndefined();
      expect(() => cacheSnapshot(snapshot(), oldLifetime)).toThrow(
        StaleAccountError,
      );
      expect(() => beginAccountChange()).not.toThrow();
    },
  );

  it.each(["success", "network failure"])(
    "rejects a late API %s after the same account signs in again",
    async (outcome) => {
      startAccountLifetime(userId);
      const response = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => response.promise),
      );
      const request = api("/snapshot");
      const rejected =
        expect(request).rejects.toBeInstanceOf(StaleAccountError);
      clearLocal();
      startAccountLifetime(userId);
      if (outcome === "success")
        response.resolve(new Response(JSON.stringify(snapshot())));
      else response.reject(new TypeError("Network unavailable"));
      await rejected;
      expect(stored.has(cacheKey)).toBe(false);
      expect(stored.has(queueKey)).toBe(false);
    },
  );

  it("checks the lifetime again after an asynchronously decoded response", async () => {
    const decoded = deferred<Snapshot>();
    const decoding = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: () => {
          decoding.resolve();
          return decoded.promise;
        },
      })),
    );
    const request = api("/snapshot");
    const rejected = expect(request).rejects.toBeInstanceOf(StaleAccountError);
    await decoding.promise;
    clearLocal();
    decoded.resolve(snapshot());
    await rejected;
  });

  it.each([200, 404, "network"] as const)(
    "a late replay result (%s) cannot write into a new lifetime's queue",
    async (status) => {
      startAccountLifetime(userId);
      enqueue(userId, "/logs", [entry]);
      enqueue(userId, "/logs", [{ ...entry, id: crypto.randomUUID() }]);
      const response = deferred<Response>();
      const fetcher = vi.fn(() => response.promise);
      vi.stubGlobal("fetch", fetcher);
      const replay = syncQueue(userId);
      const rejected = expect(replay).rejects.toBeInstanceOf(StaleAccountError);
      clearLocal();
      startAccountLifetime(userId);
      enqueue(userId, "/logs", [
        { ...entry, id: crypto.randomUUID(), name: "New lifetime" },
      ]);
      const fresh = stored.get(queueKey);
      if (status === "network") response.reject(new TypeError("Offline"));
      else
        response.resolve(
          new Response(JSON.stringify({ error: "Missing", ok: true }), {
            status,
          }),
        );
      await rejected;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(stored.get(queueKey)).toBe(fresh);
    },
  );

  it.each(["retry", "discard"])(
    "cancels %s while it waits for a previous replay",
    async (action) => {
      enqueue(userId, "/logs", [entry]);
      const response = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => response.promise),
      );
      const itemId = pending()[0].id;
      const replay = syncQueue(userId);
      const recovery =
        action === "retry"
          ? retryPending(userId, itemId)
          : discardPending(userId, itemId);
      const rejected = [replay, recovery].map((operation) =>
        expect(operation).rejects.toBeInstanceOf(StaleAccountError),
      );
      clearLocal();
      enqueue(userId, "/logs", [{ ...entry, id: crypto.randomUUID() }]);
      const fresh = stored.get(queueKey);
      response.resolve(new Response(JSON.stringify({ ok: true })));
      await Promise.all(rejected);
      expect(stored.get(queueKey)).toBe(fresh);
    },
  );

  it("an old replay's cleanup cannot remove a newer replay for the same account", async () => {
    enqueue(userId, "/logs", [entry]);
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => newResponse.promise);
    vi.stubGlobal("fetch", fetcher);
    const oldReplay = syncQueue(userId);
    const rejected =
      expect(oldReplay).rejects.toBeInstanceOf(StaleAccountError);
    clearLocal();
    enqueue(userId, "/logs", [{ ...entry, id: crypto.randomUUID() }]);
    const newReplay = syncQueue(userId);
    oldResponse.resolve(new Response(JSON.stringify({ ok: true })));
    await rejected;
    expect(syncQueue(userId)).toBe(newReplay);
    expect(fetcher).toHaveBeenCalledTimes(2);
    newResponse.resolve(new Response(JSON.stringify({ ok: true })));
    await newReplay;
    expect(pending()).toEqual([]);
  });

  it("pauses account work during a transition and resumes without discarding local data on failure", async () => {
    startAccountLifetime(userId);
    const prior = accountLifetime();
    cacheSnapshot(snapshot());
    enqueue(userId, "/logs", [entry]);
    beginAccountChange();
    expect(() => cacheSnapshot(snapshot(), prior)).toThrow(StaleAccountError);
    expect(() => enqueue(userId, "/logs", [entry])).toThrow(StaleAccountError);
    await expect(syncQueue(userId)).rejects.toBeInstanceOf(StaleAccountError);
    expect(pending()).toHaveLength(1);
    expect(cachedSnapshot()).not.toBeNull();
    startAccountLifetime(userId);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
    );
    await syncQueue(userId);
    expect(pending()).toEqual([]);
    expect(cacheSnapshot(snapshot())).toBe(true);
  });
});
