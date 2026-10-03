import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Food, Snapshot } from "../../shared/domain";

const headers = { "X-Bulkbro-Client": "1" };
const password = "food-regression-password";
test.setTimeout(60_000);

async function register(page: Page) {
  const suffix = randomUUID().slice(0, 8);
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: { email: `food-regression-${suffix}@example.test`, password },
  });
  expect(registered.ok()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers,
    data: {
      name: "Food Regression",
      username: `food_${suffix}`,
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
  expect(profile.ok()).toBeTruthy();
}

async function snapshot(page: Page): Promise<Snapshot> {
  const response = await page.request.get("/api/snapshot");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.afterEach(async ({ page }) => {
  await page.request.delete("/api/account", { headers, data: { password } });
});

test("one-third recipe portions can change name and meal without rounding quantity or nutrition", async ({
  page,
}) => {
  await register(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.getByLabel("Food name", { exact: true }).fill("Recipe oats");
  for (const [label, value] of [
    ["calories (kcal)", "200"],
    ["protein (g)", "10"],
    ["carbs (g)", "30"],
    ["fat (g)", "4"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel("Quantity (g)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Add to meal", exact: true }).click();
  await page.getByText("Save this as a recipe or reusable meal").click();
  await page.getByLabel("Recipe name", { exact: true }).fill("Three portions");
  await page.getByLabel("Number of servings", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recipe saved" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add another food", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: "Add portion", exact: true }).click();
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const before = (await snapshot(page)).logs[0];
  expect(before.serving).toBe(100 / 3);
  expect(before.calories).toBeCloseTo(200 / 3, 12);

  await page.reload();
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit Recipe oats", exact: true })
    .click();
  await expect(page.getByLabel("Quantity (g)", { exact: true })).toHaveValue(
    String(before.serving),
  );
  await page.getByLabel("Food name", { exact: true }).fill("A third of oats");
  await page.getByLabel("Meal", { exact: true }).fill("Lunch");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const expected = { ...before, name: "A third of oats", meal: "Lunch" };
  expect((await snapshot(page)).logs).toEqual([expected]);
  await page.reload();
  expect((await snapshot(page)).logs).toEqual([expected]);
  await expect(page.getByTestId("consumed-calories")).toHaveText("67");
});

for (const starredCopies of [1, 2]) {
  test(`legacy duplicate foods retain ${starredCopies} later favourite IDs and toggle without creating copies`, async ({
    page,
  }) => {
    await register(page);
    const copies: Food[] = [];
    for (let index = 0; index <= starredCopies; index++) {
      const created = await page.request.post("/api/foods", {
        headers,
        data: {
          name: "Legacy oats",
          brand: "Pantry",
          serving: 100,
          unit: "g",
          calories: 200,
          protein: 10,
          carbs: 30,
          fat: 4,
        },
      });
      expect(created.ok()).toBeTruthy();
      const food: Food = await created.json();
      copies.push(food);
      if (index > 0) {
        const starred = await page.request.put(`/api/favourites/${food.id}`, {
          headers,
          data: { active: true },
        });
        expect(starred.ok()).toBeTruthy();
      }
    }
    await page.goto("/");
    await page.reload();
    await page.getByRole("button", { name: "Log food", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your favourites" }),
    ).toBeVisible();
    await page.getByLabel("Search your foods").fill("Legacy oats");
    await expect(
      page.getByRole("button", { name: "Add Legacy oats", exact: true }),
    ).toHaveCount(1);
    const unstar = page.getByRole("button", {
      name: "Unfavourite Legacy oats",
      exact: true,
    });
    await expect(unstar).toHaveAttribute("aria-pressed", "true");
    await unstar.click();
    const star = page.getByRole("button", {
      name: "Favourite Legacy oats",
      exact: true,
    });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    expect((await snapshot(page)).favourites).toEqual([]);

    await page.reload();
    await page.getByRole("button", { name: "Log food", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your favourites" }),
    ).toHaveCount(0);
    await page.getByLabel("Search your foods").fill("Legacy oats");
    await star.click();
    await expect(unstar).toHaveAttribute("aria-pressed", "true");
    const after = await snapshot(page);
    expect(after.foods).toEqual(copies);
    expect(after.favourites).toEqual([copies[0].id]);
    await page.reload();
    await page.getByRole("button", { name: "Log food", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your favourites" }),
    ).toBeVisible();
    await page.getByLabel("Search your foods").fill("Legacy oats");
    await expect(unstar).toHaveAttribute("aria-pressed", "true");
    expect((await snapshot(page)).foods).toEqual(copies);
  });
}
