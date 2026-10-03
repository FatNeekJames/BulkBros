import { test, expect } from "@playwright/test";
test("meal scan explains exhausted credit and offers manual logging", async ({
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
  await page.route("**/api/ai/meal", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "AI_CREDITS_EXHAUSTED",
        error:
          "AI features are unavailable because the connected OpenAI API project has no credit. Food logging and training tracking still work.",
      }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Food diary" }).click();
  await page.getByRole("button", { name: "Scan meal", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "meal.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Analyse meal" }).click();
  await expect(page.getByRole("alert")).toContainText("no credit");
  await page.getByRole("button", { name: "Enter food manually" }).click();
  await expect(page.getByLabel("Food name", { exact: true })).toBeVisible();
  await page.request.delete("/api/account", {
    headers,
    data: { password: "a-strong-test-password" },
  });
});
