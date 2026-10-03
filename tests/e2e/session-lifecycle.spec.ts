import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { FoodLog, Snapshot } from "../../shared/domain";

const headers = { "X-Bulkbro-Client": "1" };
const password = "session-lifecycle-password";
const accounts = new Map<Page, string>();
test.setTimeout(60_000);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(page: Page) {
  const suffix = randomUUID().slice(0, 8);
  const email = `lifetime-${suffix}@example.test`;
  accounts.set(page, email);
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers,
        data: { email, password },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.put("/api/profile", {
        headers,
        data: {
          name: "Lifetime Owner",
          username: `life_${suffix}`,
          age: 30,
          sex: "female",
          height: 165,
          weight: 65,
          targetWeight: 65,
          units: "metric",
          activity: "light",
          workoutsPerWeek: 3,
          goal: "maintain",
          speed: "slow",
          stepGoal: 8000,
          exerciseCalories: false,
        },
      })
    ).ok(),
  ).toBeTruthy();
  const entry: FoodLog = {
    id: randomUUID(),
    date: "2026-10-03",
    meal: "Breakfast",
    name: "Private lifetime oats",
    brand: "",
    serving: 100,
    unit: "g",
    calories: 300,
    protein: 20,
    carbs: 40,
    fat: 6,
    fibre: 1,
    source: "User entry",
  };
  expect(
    (await page.request.post("/api/logs", { headers, data: [entry] })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Settings & profile", exact: true }),
  ).toBeVisible();
  return { email, entry };
}

async function settings(page: Page) {
  await page
    .getByRole("button", { name: "Settings & profile", exact: true })
    .click();
}

async function signOut(page: Page) {
  await settings(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create your account", exact: true }),
  ).toBeVisible();
}

async function storage(page: Page) {
  return page.evaluate(() => ({
    cache: localStorage.getItem("bulkbro-cache"),
    queue: localStorage.getItem("bulkbro-pending-v1"),
  }));
}

async function signedOut(page: Page) {
  await expect(
    page.getByRole("button", { name: "Create your account", exact: true }),
  ).toBeVisible();
  expect(await storage(page)).toEqual({ cache: null, queue: null });
  await expect(
    page.getByText("Private lifetime oats", { exact: true }),
  ).toHaveCount(0);
}

async function holdRequest(
  page: Page,
  pattern: string,
  outcome: "success" | "network" = "success",
) {
  const started = deferred();
  const release = deferred();
  const completed = deferred();
  const token = randomUUID();
  await page.evaluate(
    ({ fragment, token }) => {
      const state = window as unknown as {
        lifecycleSettled?: Record<string, boolean>;
      };
      state.lifecycleSettled ||= {};
      const original = window.fetch;
      let matched = false;
      window.fetch = async (...args) => {
        const input = args[0];
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (matched || !url.includes(fragment)) return original(...args);
        matched = true;
        try {
          const response = await original(...args);
          // Drain a clone, since cancelled application work need not consume its response body.
          await response.clone().arrayBuffer();
          return response;
        } finally {
          state.lifecycleSettled![token] = true;
          window.fetch = original;
        }
      };
    },
    { fragment: pattern.replaceAll("*", ""), token },
  );
  await page.route(
    pattern,
    async (route: Route) => {
      const response = outcome === "success" ? await route.fetch() : undefined;
      started.resolve();
      await release.promise;
      if (response) await route.fulfill({ response });
      else await route.abort("failed");
      completed.resolve();
    },
    { times: 1 },
  );
  return {
    started: started.promise,
    release: async () => {
      release.resolve();
      await completed.promise;
      await page.waitForFunction(
        (token) =>
          (window as unknown as { lifecycleSettled?: Record<string, boolean> })
            .lifecycleSettled?.[token] === true,
        token,
      );
      // Let fetch/json continuations and React's resulting render finish before asserting absence.
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
    },
  };
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const email = accounts.get(page);
  if (email) {
    await page.request.post("/api/auth/login", {
      headers,
      data: { email, password },
    });
    await page.request.delete("/api/account", { headers, data: { password } });
    accounts.delete(page);
  }
});

test("a snapshot delivered after logout cannot restore the diary or offline cache", async ({
  page,
}) => {
  await setup(page);
  const delayed = await holdRequest(page, "**/api/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await delayed.started;
  await signOut(page);
  await delayed.release();
  await signedOut(page);
});

test("a snapshot from a prior sign-in cannot overwrite a new sign-in to the same account", async ({
  page,
}) => {
  const { email, entry } = await setup(page);
  const delayed = await holdRequest(page, "**/api/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await delayed.started;
  expect(
    (await page.request.delete(`/api/logs/${entry.id}`, { headers })).ok(),
  ).toBeTruthy();
  await signOut(page);
  await page
    .getByRole("button", {
      name: "Already have an account? Sign in",
      exact: true,
    })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("consumed-calories")).toHaveText("0");
  await delayed.release();
  await expect(page.getByTestId("consumed-calories")).toHaveText("0");
  expect((JSON.parse((await storage(page)).cache!) as Snapshot).logs).toEqual(
    [],
  );
});

for (const outcome of ["success", "network"] as const) {
  test(`a mutation's late ${outcome} result cannot restore data or enqueue after logout`, async ({
    page,
  }) => {
    const { entry } = await setup(page);
    const delayed = await holdRequest(page, `**/api/logs/${entry.id}`, outcome);
    await page.getByRole("button", { name: "Food diary", exact: true }).click();
    await page.getByLabel("Selected date", { exact: true }).fill(entry.date);
    await page
      .getByRole("button", { name: `Delete ${entry.name}`, exact: true })
      .click();
    await delayed.started;
    await signOut(page);
    await delayed.release();
    await signedOut(page);
  });
}

test("logout stops an existing offline replay before its next item or queue write", async ({
  page,
}) => {
  const { entry } = await setup(page);
  const snapshot = (await (
    await page.request.get("/api/snapshot")
  ).json()) as Snapshot;
  const queued = [1, 2].map((number) => ({
    id: randomUUID(),
    userId: snapshot.user.id,
    path: "/logs",
    method: "POST",
    body: [{ ...entry, id: randomUUID(), name: `Pending ${number}` }],
  }));
  await page.evaluate(
    (items) =>
      localStorage.setItem("bulkbro-pending-v1", JSON.stringify(items)),
    queued,
  );
  let replayRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/logs") && request.method() === "POST")
      replayRequests++;
  });
  const delayed = await holdRequest(page, "**/api/logs");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await delayed.started;
  await signOut(page);
  await delayed.release();
  await signedOut(page);
  expect(replayRequests).toBe(1);
});

test("account deletion invalidates an earlier snapshot response", async ({
  page,
}) => {
  await setup(page);
  const delayed = await holdRequest(page, "**/api/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await delayed.started;
  await settings(page);
  await page
    .getByRole("button", { name: "Delete account & data", exact: true })
    .click();
  await page
    .getByLabel("Confirm with your password", { exact: true })
    .fill(password);
  await page
    .getByRole("button", { name: "Permanently delete my account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create your account", exact: true }),
  ).toBeVisible();
  await delayed.release();
  await signedOut(page);
  accounts.delete(page);
});

test("a failed logout preserves the account and permits a subsequent save", async ({
  page,
}) => {
  const { entry } = await setup(page);
  await page.route(
    "**/api/auth/logout",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Logout temporarily unavailable" }),
      }),
    { times: 1 },
  );
  await settings(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByText("Logout temporarily unavailable", { exact: true }),
  ).toBeVisible();
  expect((await storage(page)).cache).not.toBeNull();
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
  await page.getByLabel("Selected date", { exact: true }).fill(entry.date);
  await page
    .getByRole("button", { name: `Delete ${entry.name}`, exact: true })
    .click();
  await expect(page.getByText(entry.name, { exact: true })).toHaveCount(0);
  expect((await (await page.request.get("/api/snapshot")).json()).logs).toEqual(
    [],
  );
});

test("a rejected deletion keeps the account usable", async ({ page }) => {
  const { entry } = await setup(page);
  await settings(page);
  await page
    .getByRole("button", { name: "Delete account & data", exact: true })
    .click();
  await page
    .getByLabel("Confirm with your password", { exact: true })
    .fill("incorrect-password");
  await page
    .getByRole("button", { name: "Permanently delete my account", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Password is incorrect", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
  await page.getByLabel("Selected date", { exact: true }).fill(entry.date);
  await page
    .getByRole("button", { name: `Delete ${entry.name}`, exact: true })
    .click();
  await expect(page.getByText(entry.name, { exact: true })).toHaveCount(0);
  expect((await storage(page)).cache).not.toBeNull();
});
