import { test, expect } from "@playwright/test";
test("manual logging is available without AI or external food requests", async ({
  page,
}) => {
  const suffix = Date.now(),
    headers = { "X-Bulkbro-Client": "1" };
  await page.request.post("/api/auth/register", {
    headers,
    data: {
      email: `ai-error-${suffix}@example.test`,
      password: "a-strong-test-password",
    },
  });
  await page.request.put("/api/profile", {
    headers,
    data: {
      name: "Scanner Test",
      username: `scanner_${suffix}`,
      age: 30,
      sex: "male",
      height: 180,
      weight: 80,
      targetWeight: 80,
      units: "metric",
      activity: "moderate",
      workoutsPerWeek: 3,
      goal: "maintain",
      speed: "slow",
      stepGoal: 8000,
      exerciseCalories: false,
    },
  });
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/ai/") ||
      request.url().includes("/api/foods/search")
    )
      externalRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Scan meal", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await expect(page.getByLabel("Food name", { exact: true })).toBeVisible();
  await page.getByLabel("Food name", { exact: true }).fill("Manual test food");
  await page.getByLabel("calories (kcal)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Add to meal", exact: true }).click();
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Manual test food", { exact: true }),
  ).toBeVisible();
  expect(externalRequests).toEqual([]);
  await page.request.delete("/api/account", {
    headers,
    data: { password: "a-strong-test-password" },
  });
});
