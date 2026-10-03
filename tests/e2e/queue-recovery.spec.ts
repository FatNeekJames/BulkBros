import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { FoodLog, Snapshot } from "../../shared/domain";

const headers = { "X-Bulkbro-Client": "1" };
const password = "a-strong-test-password";
test.setTimeout(60_000);

async function register(page: Page) {
  const suffix = randomUUID().slice(0, 8);
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers,
        data: { email: `queue-${suffix}@example.test`, password },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.put("/api/profile", {
        headers,
        data: {
          name: "Queue Test",
          username: `queue_${suffix}`,
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
  await page.goto("/");
  return page.getByLabel("Selected date", { exact: true }).inputValue();
}

function food(name: string, meal: string, date: string): FoodLog {
  return {
    id: randomUUID(),
    name,
    meal,
    date,
    serving: 100,
    unit: "g",
    calories: 100,
    protein: 10,
    carbs: 15,
    fat: 2,
    fibre: 0,
    brand: "",
    source: "User entry",
  };
}

async function seed(page: Page, logs: FoodLog[]) {
  expect(
    (await page.request.post("/api/logs", { headers, data: logs })).ok(),
  ).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
}

async function edit(page: Page, name: string, meal?: string) {
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await page.getByLabel("Quantity (g)", { exact: true }).fill("200");
  if (meal) await page.getByLabel("Meal", { exact: true }).fill(meal);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function snapshot(page: Page): Promise<Snapshot> {
  const response = await page.request.get("/api/snapshot");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.afterEach(async ({ page }) => {
  await page.request.delete("/api/account", { headers, data: { password } });
});

test("permanent conflicts survive reload, allow unrelated writes and discard only the chosen local change", async ({
  page,
  context,
  browser,
}) => {
  const date = await register(page);
  const oats = food("Vanished oats", "Breakfast", date);
  const rice = food("Vanished rice", "Lunch", date);
  await seed(page, [oats, rice]);
  const otherDevice = await browser.newContext({
    storageState: await context.storageState(),
  });
  try {
    await context.setOffline(true);
    await edit(page, oats.name);
    await edit(page, rice.name);
    for (const entry of [oats, rice]) {
      expect(
        (
          await otherDevice.request.delete(
            new URL(`/api/logs/${entry.id}`, page.url()).href,
            { headers },
          )
        ).ok(),
      ).toBeTruthy();
    }
    await context.setOffline(false);
    const queue = page.getByRole("region", { name: "Offline changes" });
    await expect(queue.getByText(/2 changes need attention/)).toBeVisible();
    await expect(
      page.getByText("Your offline entries are synced."),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/queue-recovery-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // A stale queue for another account must neither appear nor be discarded.
    const foreignId = randomUUID();
    const foreignUser = randomUUID();
    await page.evaluate(
      ({ foreignId, foreignUser }) => {
        const items = JSON.parse(localStorage.getItem("bulkbro-pending-v1")!);
        const item = structuredClone(items[0]);
        item.id = foreignId;
        item.userId = foreignUser;
        item.body.name = "Friend private change";
        items.push(item);
        localStorage.setItem("bulkbro-pending-v1", JSON.stringify(items));
      },
      { foreignId, foreignUser },
    );
    await page.reload();
    await expect(queue.getByText(/2 changes need attention/)).toBeVisible();
    await expect(page.getByText(/Friend private change/)).toHaveCount(0);

    await page.getByRole("button", { name: "Weigh in", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("65.4");
    await page.getByRole("button", { name: "Save weigh-in" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Log food", exact: true }).click();
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await page.getByLabel("Food name", { exact: true }).fill("Fresh dinner");
    await page.getByLabel("calories (kcal)", { exact: true }).fill("300");
    await page
      .getByRole("button", { name: "Add to meal", exact: true })
      .click();
    await page.getByRole("button", { name: "Log meal", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await snapshot(page);
    expect(saved.logs.map((entry) => entry.name)).toEqual(["Fresh dinner"]);
    expect(saved.weights[0].weight).toBe(65.4);
    await expect(queue.getByText(/2 changes need attention/)).toBeVisible();

    const failedRetry = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/logs/${oats.id}`) &&
        response.request().method() === "PUT",
    );
    await queue
      .getByRole("button", { name: /^Retry Edit Vanished oats/ })
      .click();
    expect((await failedRetry).status()).toBe(404);
    await expect(queue.getByText(/2 changes need attention/)).toBeVisible();

    // Discard needs fresh account data; a failed load must keep the draft.
    await page.route("**/api/snapshot", (route) => route.abort("failed"));
    page.once("dialog", (dialog) => dialog.accept());
    await queue
      .getByRole("button", { name: /^Discard Edit Vanished oats/ })
      .click();
    await expect(page.getByRole("status")).toContainText("Could not resolve");
    await expect(queue.getByText(/2 changes need attention/)).toBeVisible();
    await page.unroute("**/api/snapshot");
    page.once("dialog", (dialog) => dialog.accept());
    await queue
      .getByRole("button", { name: /^Discard Edit Vanished oats/ })
      .click();
    await expect(queue.getByText(/1 change needs attention/)).toBeVisible();
    await expect(queue.getByText(/Vanished oats/)).toHaveCount(0);
    await expect(page.getByTestId("consumed-calories")).toHaveText("500");

    // Cached fallback must also stop showing the explicitly discarded edit.
    await page.route("**/api/snapshot", (route) => route.abort("failed"));
    await page.reload();
    await expect(page.getByTestId("consumed-calories")).toHaveText("500");
    await expect(queue.getByText(/1 change needs attention/)).toBeVisible();
    await expect(page.getByText(/Vanished oats/)).toHaveCount(0);
    await page.unroute("**/api/snapshot");
    page.once("dialog", (dialog) => dialog.accept());
    await queue
      .getByRole("button", { name: /^Discard Edit Vanished rice/ })
      .click();
    await expect(queue).toHaveCount(0);
    await expect(page.getByTestId("consumed-calories")).toHaveText("300");
    const keptIds = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bulkbro-pending-v1")!).map(
        (item: { id: string }) => item.id,
      ),
    );
    expect(keptIds).toEqual([foreignId]);
  } finally {
    await context.setOffline(false);
    await otherDevice.close();
  }
});

test("discard waits for an active replay before rebuilding the cached diary", async ({
  page,
  context,
  browser,
}) => {
  const date = await register(page);
  const oats = food("Discard after replay", "Breakfast", date);
  await seed(page, [oats]);
  const otherDevice = await browser.newContext({
    storageState: await context.storageState(),
  });
  let releaseReplay!: () => void;
  const replayHeld = new Promise<void>((resolve) => {
    releaseReplay = resolve;
  });
  let reportReplayStarted!: () => void;
  const replayStarted = new Promise<void>((resolve) => {
    reportReplayStarted = resolve;
  });
  try {
    await context.setOffline(true);
    await edit(page, oats.name);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "Weigh in", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("66.2");
    await page.getByRole("button", { name: "Save weigh-in" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (
        await otherDevice.request.delete(
          new URL(`/api/logs/${oats.id}`, page.url()).href,
          { headers },
        )
      ).ok(),
    ).toBeTruthy();
    await page.route("**/api/weights", async (route) => {
      reportReplayStarted();
      await replayHeld;
      await route.continue();
    });
    await context.setOffline(false);
    await replayStarted;
    const queue = page.getByRole("region", { name: "Offline changes" });
    await queue.getByText("Review saved changes", { exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await queue
      .getByRole("button", { name: /^Discard Edit Discard after replay/ })
      .click();
    await expect(
      queue.getByRole("button", { name: "Checking…" }),
    ).toBeDisabled();
    // A baseline read before the held weigh-in commits would lose it from
    // the cache once replay clears its queue item.
    const readBeforeReplay = await page
      .waitForRequest("**/api/snapshot", { timeout: 500 })
      .then(
        () => true,
        () => false,
      );
    expect(readBeforeReplay).toBe(false);
    releaseReplay();
    await expect(queue).toHaveCount(0);
    const persisted = await snapshot(page);
    expect(persisted.logs).toHaveLength(0);
    expect(persisted.weights[0].weight).toBe(66.2);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("bulkbro-cache")!).weights.map(
          (entry: { weight: number }) => entry.weight,
        ),
      ),
    ).toEqual([66.2]);
    await page.route("**/api/snapshot", (route) => route.abort("failed"));
    await page.reload();
    await expect(page.getByTestId("consumed-calories")).toHaveText("0");
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("bulkbro-cache")!).weights[0].weight,
      ),
    ).toBe(66.2);
  } finally {
    releaseReplay();
    await context.setOffline(false);
    await otherDevice.close();
  }
});

test("offline delete then move keeps the moved food and totals when loading a cached diary", async ({
  page,
  context,
}) => {
  const date = await register(page);
  const breakfast = food("Original breakfast", "Breakfast", date);
  const lunch = food("Moved lunch", "Lunch", date);
  await seed(page, [breakfast, lunch]);
  await context.setOffline(true);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".diary-meal")
    .filter({ has: page.getByRole("heading", { name: /^Breakfast/ }) })
    .getByRole("button", { name: "Delete meal", exact: true })
    .click();
  await expect(
    page.getByText("Original breakfast", { exact: true }),
  ).toHaveCount(0);
  await edit(page, lunch.name, "Breakfast");
  await expect(
    page.getByRole("region", { name: "Offline changes" }),
  ).toContainText("2 entries waiting to sync");

  // Keep assets available but fail snapshot/replay requests during the reload.
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByTestId("consumed-calories")).toHaveText("200");
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
  const breakfastMeal = page
    .locator(".diary-meal")
    .filter({ has: page.getByRole("heading", { name: /^Breakfast/ }) });
  await expect(
    breakfastMeal.getByText("Moved lunch", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Original breakfast", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Offline changes" }),
  ).toContainText("2 entries waiting to sync");
  await page.unroute("**/api/**");
  await page.getByRole("button", { name: "Retry sync", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Offline changes" }),
  ).toHaveCount(0);
  expect((await snapshot(page)).logs).toEqual([
    {
      ...lunch,
      meal: "Breakfast",
      serving: 200,
      calories: 200,
      protein: 20,
      carbs: 30,
      fat: 4,
    },
  ]);
});
