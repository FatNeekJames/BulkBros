import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import type { FoodLog, Snapshot } from "../../shared/domain";

const headers = { "X-Bulkbro-Client": "1" };
const password = "cross-tab-lifecycle-password";
const accounts = new Map<BrowserContext, string[]>();
const pendingReleases = new Map<BrowserContext, (() => void)[]>();
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
  const email = `cross-tab-${suffix}@example.test`;
  accounts.set(page.context(), [
    ...(accounts.get(page.context()) ?? []),
    email,
  ]);
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
          name: "Cross Tab Owner",
          username: `tabs_${suffix}`,
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
    name: "Private cross tab oats",
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
  const peer = await page.context().newPage();
  await peer.goto("/");
  await expect(
    peer.getByRole("button", { name: "Settings & profile", exact: true }),
  ).toBeVisible();
  return { email, entry, peer };
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
    page.getByText("Private cross tab oats", { exact: true }),
  ).toHaveCount(0);
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
  await signedOut(page);
}

async function signIn(page: Page, email: string) {
  await page
    .getByRole("button", {
      name: "Already have an account? Sign in",
      exact: true,
    })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Settings & profile", exact: true }),
  ).toBeVisible();
}

async function holdRequest(
  page: Page,
  path: string,
  outcome: "success" | "network" = "success",
) {
  const started = deferred();
  const release = deferred();
  const completed = deferred();
  const signal = randomUUID();
  const context = page.context();
  pendingReleases.set(context, [
    ...(pendingReleases.get(context) ?? []),
    release.resolve,
  ]);

  // A stale request may intentionally stop before reading response.json().
  // Independently consume a clone so settlement never depends on that app path.
  await page.evaluate(
    ({ path, signal }) => {
      const fetch = window.fetch.bind(window);
      let waiting = true;
      window.fetch = async (...args) => {
        const input = args[0];
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          location.href,
        );
        const observe = waiting && url.pathname === path;
        if (observe) waiting = false;
        try {
          const response = await fetch(...args);
          if (observe) await response.clone().text();
          return response;
        } finally {
          if (observe) document.documentElement.dataset.settledRequest = signal;
        }
      };
    },
    { path, signal },
  );

  await page.route(
    `**${path}`,
    async (route: Route) => {
      const response = outcome === "success" ? await route.fetch() : undefined;
      started.resolve();
      await release.promise;
      try {
        if (response) await route.fulfill({ response });
        else await route.abort("failed");
      } finally {
        completed.resolve();
      }
    },
    { times: 1 },
  );

  return {
    started: started.promise,
    release: async () => {
      release.resolve();
      await completed.promise;
      await page.waitForFunction(
        (expected) =>
          document.documentElement.dataset.settledRequest === expected,
        signal,
      );
      await page.evaluate(
        () =>
          new Promise<void>((done) => {
            queueMicrotask(() =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            );
          }),
      );
    },
  };
}

test.afterEach(async ({ context }, testInfo) => {
  for (const release of pendingReleases.get(context) ?? []) release();
  pendingReleases.delete(context);
  const cleanupErrors: unknown[] = [];
  for (const page of context.pages()) {
    try {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const email of accounts.get(context) ?? []) {
    try {
      const login = await context.request.post("/api/auth/login", {
        headers,
        data: { email, password },
      });
      // Account-deletion cases have already removed this synthetic account.
      if (login.status() === 401) continue;
      expect(login.ok()).toBeTruthy();
      expect(
        (
          await context.request.delete("/api/account", {
            headers,
            data: { password },
          })
        ).ok(),
      ).toBeTruthy();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  accounts.delete(context);
  if (cleanupErrors.length) {
    await testInfo.attach("cleanup-errors", {
      body: cleanupErrors.map(String).join("\n"),
      contentType: "text/plain",
    });
    if (testInfo.status === testInfo.expectedStatus)
      throw new AggregateError(
        cleanupErrors,
        "Synthetic account cleanup failed",
      );
  }
});

test("another tab's logout invalidates an already-fetched snapshot and clears both tabs", async ({
  page,
}) => {
  const { peer } = await setup(page);
  const held = await holdRequest(page, "/api/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await held.started;
  await signOut(peer);
  await signedOut(page);
  await held.release();
  await signedOut(page);
  await signedOut(peer);
});

test("another tab's account deletion invalidates an already-fetched snapshot", async ({
  page,
}) => {
  const { peer } = await setup(page);
  const held = await holdRequest(page, "/api/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await held.started;
  await settings(peer);
  await peer
    .getByRole("button", { name: "Delete account & data", exact: true })
    .click();
  await peer
    .getByLabel("Confirm with your password", { exact: true })
    .fill(password);
  await peer
    .getByRole("button", { name: "Permanently delete my account", exact: true })
    .click();
  await signedOut(peer);
  await signedOut(page);
  await held.release();
  await signedOut(page);
  await signedOut(peer);
});

test("a failed mutation in one tab cannot enqueue after another tab signs out", async ({
  page,
}) => {
  const { peer, entry } = await setup(page);
  const held = await holdRequest(page, `/api/logs/${entry.id}`, "network");
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
  await page.getByLabel("Selected date", { exact: true }).fill(entry.date);
  await page
    .getByRole("button", { name: `Delete ${entry.name}`, exact: true })
    .click();
  await held.started;
  await signOut(peer);
  await signedOut(page);
  await held.release();
  await signedOut(page);
  await signedOut(peer);
});

test("a prior tab response cannot overwrite a same-account sign-in after peer logout", async ({
  page,
}) => {
  const { peer, email, entry } = await setup(page);
  const held = await holdRequest(page, "/api/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await held.started;
  expect(
    (await peer.request.delete(`/api/logs/${entry.id}`, { headers })).ok(),
  ).toBeTruthy();
  await signOut(peer);
  await signedOut(page);
  await signIn(peer, email);
  await expect(
    page.getByRole("button", { name: "Settings & profile", exact: true }),
  ).toBeVisible();
  for (const tab of [page, peer]) {
    await expect(tab.getByTestId("consumed-calories")).toHaveText("0");
    expect((JSON.parse((await storage(tab)).cache!) as Snapshot).logs).toEqual(
      [],
    );
  }
  await held.release();
  for (const tab of [page, peer]) {
    await expect(tab.getByTestId("consumed-calories")).toHaveText("0");
    expect((JSON.parse((await storage(tab)).cache!) as Snapshot).logs).toEqual(
      [],
    );
    expect((await storage(tab)).queue).toBeNull();
  }
});
