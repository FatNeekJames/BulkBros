import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { offsetDate, type Snapshot } from "../../shared/domain";

const headers = { "X-Bulkbro-Client": "1" };
const password = "a-strong-test-password";
test.use({ timezoneId: "Europe/London" });
test.setTimeout(60_000);

async function register(page: Page, prefix: string) {
  const suffix = randomUUID().slice(0, 8);
  const email = `${prefix}-${suffix}@example.test`;
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: { email, password },
  });
  expect(registered.ok()).toBeTruthy();
  const saved = await page.request.put("/api/profile", {
    headers,
    data: {
      name: "Daily Test",
      username: `daily_${suffix}`,
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
      targets: { calories: 2000, protein: 100, carbs: 250, fat: 60 },
    },
  });
  expect(saved.ok()).toBeTruthy();
  return email;
}

async function snapshot(page: Page): Promise<Snapshot> {
  const response = await page.request.get("/api/snapshot");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openManual(page: Page) {
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
}

async function prepareFood(
  page: Page,
  name: string,
  basis: "Per 100 g" | "Per serving" = "Per 100 g",
  quantity = "100",
) {
  await page.getByLabel("Food name", { exact: true }).fill(name);
  await page
    .getByLabel("Nutrition label", { exact: true })
    .selectOption({ label: basis });
  await page.getByLabel("calories (kcal)", { exact: true }).fill("200");
  await page.getByLabel("protein (g)", { exact: true }).fill("10");
  await page.getByLabel("carbs (g)", { exact: true }).fill("30");
  await page.getByLabel("fat (g)", { exact: true }).fill("4");
  await page
    .getByLabel(basis === "Per 100 g" ? "Quantity (g)" : "Quantity (serving)", {
      exact: true,
    })
    .fill(quantity);
  await page.getByRole("button", { name: "Add to meal", exact: true }).click();
}

async function saveMeal(page: Page) {
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function dashboardTotals(
  page: Page,
  calories: string,
  protein: string,
  carbs: string,
  fat: string,
) {
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByTestId("consumed-calories")).toHaveText(calories);
  await expect(page.getByTestId("consumed-protein")).toHaveText(protein);
  await expect(page.getByTestId("consumed-carbs")).toHaveText(carbs);
  await expect(page.getByTestId("consumed-fat")).toHaveText(fat);
}

test.afterEach(async ({ page }) => {
  await page.request.delete("/api/account", { headers, data: { password } });
});

test("100 g and per-serving labels scale, correct and delete with accurate daily totals", async ({
  page,
}) => {
  await register(page, "portions");
  await page.goto("/");
  for (const basis of ["Per 100 g", "Per serving"] as const) {
    const grams = basis === "Per 100 g";
    const name = grams ? "Acceptance oats" : "Acceptance yoghurt";
    await openManual(page);
    await prepareFood(page, name, basis, grams ? "150" : "1.5");
    await saveMeal(page);
    await dashboardTotals(page, "300", "15.0", "45.0", "6.0");
    let saved = await snapshot(page);
    expect(saved.logs).toHaveLength(1);
    expect(saved.logs[0]).toMatchObject({
      calories: 300,
      protein: 15,
      carbs: 45,
      fat: 6,
    });

    await page.getByRole("button", { name: "Food diary", exact: true }).click();
    await page
      .getByRole("button", { name: `Edit ${name}`, exact: true })
      .click();
    await page
      .getByLabel(grams ? "Quantity (g)" : "Quantity (serving)", {
        exact: true,
      })
      .fill(grams ? "200" : "2");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await dashboardTotals(page, "400", "20.0", "60.0", "8.0");
    saved = await snapshot(page);
    expect(saved.logs[0]).toMatchObject({
      calories: 400,
      protein: 20,
      carbs: 60,
      fat: 8,
    });
    expect(saved.foods.find((food) => food.name === name)).toMatchObject({
      calories: 200,
      serving: grams ? 100 : 1,
    });

    await page.getByRole("button", { name: "Food diary", exact: true }).click();
    await page
      .getByRole("button", { name: `Delete ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: `Delete ${name}`, exact: true }),
    ).toHaveCount(0);
    await dashboardTotals(page, "0", "0.0", "0.0", "0.0");
    expect((await snapshot(page)).logs).toHaveLength(0);
  }
});

test("yesterday and today persist, backfills repair streaks, and targets preserve historical food", async ({
  page,
}) => {
  await register(page, "calendar");
  await page.goto("/");
  const today = await page
    .getByLabel("Selected date", { exact: true })
    .inputValue();
  const yesterday = offsetDate(today, -1);
  const prior = offsetDate(today, -2);
  await expect(page.getByText(/Today · Europe\/London/)).toBeVisible();
  for (const [date, name] of [
    [prior, "Earlier breakfast"],
    [today, "Today breakfast"],
  ]) {
    await page.getByLabel("Selected date", { exact: true }).fill(date);
    await openManual(page);
    await prepareFood(page, name);
    await saveMeal(page);
  }
  await expect(page.getByTestId("current-streak")).toHaveText("1");
  await expect(page.getByTestId("best-streak")).toHaveText("1");

  await page.getByLabel("Selected date", { exact: true }).fill(yesterday);
  await openManual(page);
  await prepareFood(page, "Yesterday lunch");
  await page.getByLabel("Meal", { exact: true }).fill("Lunch");
  await saveMeal(page);
  await expect(page.getByTestId("current-streak")).toHaveText("3");
  await expect(page.getByTestId("best-streak")).toHaveText("3");
  await expect(page.getByTestId("day-completion")).toContainText("complete");
  const before = (await snapshot(page)).logs;
  await page.reload();
  await expect(page.getByTestId("current-streak")).toHaveText("3");
  await page.getByLabel("Selected date", { exact: true }).fill(yesterday);
  await expect(
    page.getByText("Yesterday lunch", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Edit daily targets", exact: true })
    .click();
  await page.getByLabel("Calories (kcal)", { exact: true }).fill("100");
  await page.getByLabel("Protein (g)", { exact: true }).fill("5");
  await page.getByLabel("Carbohydrates (g)", { exact: true }).fill("15");
  await page.getByLabel("Fat (g)", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save targets", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Above target", { exact: true })).toBeVisible();
  await expect(page.getByTestId("remaining-calories")).toContainText("100");
  expect((await snapshot(page)).logs).toEqual(before);
  for (const bar of await page.getByRole("progressbar").all()) {
    const width = await bar
      .locator("span")
      .evaluate((element) => parseFloat((element as HTMLElement).style.width));
    expect(width).toBeGreaterThanOrEqual(0);
    expect(width).toBeLessThanOrEqual(100);
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(Number(await bar.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(
      100,
    );
  }
  await expect(
    page.getByRole("progressbar", { name: "protein", exact: true }),
  ).toHaveAttribute("aria-valuenow", "100");
  await expect(
    page.getByRole("progressbar", { name: "protein", exact: true }),
  ).toHaveAttribute("aria-valuetext", "10 of 5, over target");
  await page
    .getByRole("button", { name: "Edit daily targets", exact: true })
    .click();
  for (const label of ["Protein (g)", "Carbohydrates (g)", "Fat (g)"]) {
    await page.getByLabel(label, { exact: true }).fill("0");
  }
  await page.getByRole("button", { name: "Save targets", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const name of ["protein", "Carbohydrates", "fat"]) {
    const bar = page.getByRole("progressbar", { name, exact: true });
    await expect(bar).toHaveAttribute("aria-valuenow", "100");
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
    await expect(bar).toHaveAttribute("aria-valuetext", /of 0, over target/);
    expect(
      await bar
        .locator("span")
        .evaluate((element) => (element as HTMLElement).style.width),
    ).toBe("100%");
  }
  await page.reload();
  await page.getByLabel("Selected date", { exact: true }).fill(yesterday);
  await expect(page.getByText("Above target", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete Yesterday lunch", exact: true })
    .click();
  await expect(page.getByTestId("current-streak")).toHaveText("1");
  await expect(page.getByTestId("best-streak")).toHaveText("1");
  await expect(page.getByTestId("day-completion")).toContainText(
    "Your first meal",
  );
  await page.reload();
  await expect(page.getByTestId("current-streak")).toHaveText("1");
  expect((await snapshot(page)).logs.map((log) => log.date).sort()).toEqual([
    prior,
    today,
  ]);
  await page.getByLabel("Selected date", { exact: true }).fill(yesterday);
  for (const name of ["protein", "Carbohydrates", "fat"]) {
    const bar = page.getByRole("progressbar", { name, exact: true });
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    await expect(bar).toHaveAttribute("aria-valuetext", "0 of 0");
  }
});

test("local midnight advances today while historical selections and an open meal retain their dates", async ({
  page,
}) => {
  await register(page, "midnight");
  await page.clock.setFixedTime(new Date("2026-10-03T22:59:59Z"));
  await page.goto("/");
  await expect(page.getByLabel("Selected date", { exact: true })).toHaveValue(
    "2026-10-03",
  );
  await page.clock.setFixedTime(new Date("2026-10-03T23:00:01Z"));
  await expect(page.getByLabel("Selected date", { exact: true })).toHaveValue(
    "2026-10-04",
  );
  await page.getByLabel("Selected date", { exact: true }).fill("2026-10-02");
  await page.clock.setFixedTime(new Date("2026-10-04T23:00:01Z"));
  await expect(
    page.getByLabel("Selected date", { exact: true }),
  ).toHaveAttribute("max", "2026-10-05");
  await expect(page.getByLabel("Selected date", { exact: true })).toHaveValue(
    "2026-10-02",
  );
  await page
    .getByRole("button", { name: "Back to today", exact: true })
    .click();
  await page.clock.setFixedTime(new Date("2026-10-05T22:59:59Z"));
  await openManual(page);
  await prepareFood(page, "Late evening meal");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-10-05",
  );
  await page.clock.setFixedTime(new Date("2026-10-05T23:00:01Z"));
  await expect(
    page.getByLabel("Selected date", { exact: true }),
  ).toHaveAttribute("max", "2026-10-06");
  await expect(page.getByLabel("Selected date", { exact: true })).toHaveValue(
    "2026-10-05",
  );
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-10-05",
  );
  await saveMeal(page);
  expect((await snapshot(page)).logs[0].date).toBe("2026-10-05");
  await expect(page.getByTestId("current-streak")).toHaveText("1");
  await page
    .getByRole("button", { name: "Back to today", exact: true })
    .click();
  await expect(page.getByTestId("consumed-calories")).toHaveText("0");
  await expect(page.getByTestId("day-completion")).toContainText(
    "Your first meal",
  );
});

test("two device timezones use their local today without moving the same saved foods", async ({
  page,
  context,
  browser,
}) => {
  await register(page, "timezone");
  await page.clock.setFixedTime(new Date("2026-10-03T23:30:00Z"));
  await page.goto("/");
  await page.getByLabel("Selected date", { exact: true }).fill("2026-10-03");
  await openManual(page);
  await prepareFood(page, "Travel breakfast");
  await saveMeal(page);
  await page
    .getByRole("button", { name: "Back to today", exact: true })
    .click();
  await expect(page.getByLabel("Selected date", { exact: true })).toHaveValue(
    "2026-10-04",
  );
  await expect(page.getByTestId("consumed-calories")).toHaveText("0");
  await expect(page.getByTestId("current-streak")).toHaveText("1");
  const pacific = await browser.newContext({
    storageState: await context.storageState(),
    timezoneId: "America/Los_Angeles",
  });
  try {
    const other = await pacific.newPage();
    await other.clock.setFixedTime(new Date("2026-10-03T23:30:00Z"));
    await other.goto(page.url());
    await expect(
      other.getByLabel("Selected date", { exact: true }),
    ).toHaveValue("2026-10-03");
    await expect(other.getByText(/Today · America\/Los_Angeles/)).toBeVisible();
    await expect(other.getByTestId("consumed-calories")).toHaveText("200");
    await expect(other.getByTestId("day-completion")).toContainText("complete");
    await expect(other.getByTestId("current-streak")).toHaveText("1");
    expect((await snapshot(other)).logs).toEqual((await snapshot(page)).logs);
  } finally {
    await pacific.close();
  }
});

test("a narrow phone keeps failed saves in the form and confirms only a successful retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await register(page, "failure");
  await page.goto("/");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openManual(page);
  await prepareFood(page, "Never lose this meal", "Per 100 g", "150");
  await page.route("**/api/logs", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unable to save right now. Try again." }),
    }),
  );
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to save");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Food 1 name", { exact: true })).toHaveValue(
    "Never lose this meal",
  );
  expect((await snapshot(page)).logs).toHaveLength(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/daily-loop-mobile-failed-save.png",
    fullPage: true,
  });

  await page.unroute("**/api/logs");
  await page.route("**/api/logs", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "restoreStorageWrites", {
      value: () => {
        Storage.prototype.setItem = original;
      },
    });
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Not saved",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await snapshot(page)).logs).toHaveLength(0);
  await page.evaluate(() =>
    (
      window as unknown as { restoreStorageWrites: () => void }
    ).restoreStorageWrites(),
  );
  await page.unroute("**/api/logs");
  await saveMeal(page);
  await expect(page.getByTestId("consumed-calories")).toHaveText("300");
  await page.reload();
  await expect(page.getByTestId("consumed-calories")).toHaveText("300");
  expect((await snapshot(page)).logs).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("sign-out and a friend signing in on the same phone never expose the previous diary or recents", async ({
  page,
}) => {
  const firstEmail = await register(page, "owner");
  await page.goto("/");
  await openManual(page);
  await prepareFood(page, "Owner private breakfast");
  await saveMeal(page);
  await page
    .getByRole("button", { name: "Settings & profile", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Create your account" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("bulkbro-cache")),
  ).toBeNull();
  await register(page, "friend");
  await page.reload();
  await expect(page.getByTestId("consumed-calories")).toHaveText("0");
  await expect(page.getByTestId("current-streak")).toHaveText("0");
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await page.getByRole("button", { name: "Your foods", exact: true }).click();
  await expect(
    page.getByText("Owner private breakfast", { exact: true }),
  ).toHaveCount(0);
  const friend = await snapshot(page);
  expect(friend.logs).toEqual([]);
  expect(friend.foods).toEqual([]);
  const exported = await page.request.get("/api/account/export");
  expect(await exported.text()).not.toContain("Owner private breakfast");
  await page.request.delete("/api/account", { headers, data: { password } });
  await page.request.post("/api/auth/login", {
    headers,
    data: { email: firstEmail, password },
  });
  await page.reload();
  await expect(page.getByTestId("consumed-calories")).toHaveText("200");
  expect((await snapshot(page)).logs[0].name).toBe("Owner private breakfast");
});
