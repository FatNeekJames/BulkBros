import { test, expect } from "@playwright/test";
test("recipes, servings, offline queue and account isolation", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const headers = { "X-Bulkbro-Client": "1" };
  await page.request.post("/api/auth/register", {
    headers,
    data: {
      email: `offline-${suffix}@example.test`,
      password: "a-strong-test-password",
    },
  });
  await page.request.put("/api/profile", {
    headers,
    data: {
      name: "Offline Test",
      username: `offline_${suffix}`,
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
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.getByLabel("Food name", { exact: true }).fill("Recipe ingredient");
  await page.getByLabel("calories (kcal)", { exact: true }).fill("400");
  await page.getByLabel("protein (g)", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Add to meal", exact: true }).click();
  await page.getByText("Save this as a recipe or reusable meal").click();
  await page.getByLabel("Recipe name").fill("Two portions");
  await page.getByLabel("Number of servings").fill("2");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recipe saved", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: "Add portion", exact: true }).click();
  await expect(page.getByLabel("calories (kcal)", { exact: true })).toHaveValue(
    "200",
  );
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Weigh in", exact: true }).click();
  await page.getByLabel("Weight (kg)", { exact: true }).fill("65.4");
  await page.getByRole("button", { name: "Save weigh-in" }).click();
  await expect(page.getByText(/\d+ entries waiting to sync/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/\d+ entries waiting to sync/)).toHaveCount(0);
  const snapshot = await page.request.get("/api/snapshot");
  const s = await snapshot.json();
  expect(s.logs).toHaveLength(1);
  expect(s.logs[0].calories).toBe(200);
  expect(s.weights).toHaveLength(1);
  expect(s.weights[0].weight).toBe(65.4);
  await page.getByRole("button", { name: "Settings & profile" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create your account" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("bulkbro-cache")),
  ).toBeNull();
  await page.request.post("/api/auth/login", {
    headers,
    data: {
      email: `offline-${suffix}@example.test`,
      password: "a-strong-test-password",
    },
  });
  await page.request.delete("/api/account", {
    headers,
    data: { password: "a-strong-test-password" },
  });
});
