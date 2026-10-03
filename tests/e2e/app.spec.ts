import { test, expect } from "@playwright/test";
test("account to daily tracking, persistent reload and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("e2e-" + Date.now() + "@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a-strong-test-password");
  await page.getByRole("button", { name: "Create your account" }).click();
  await page.getByLabel("First name").fill("Test Lifter");
  await page.getByLabel("Username", { exact: true }).fill("test_" + Date.now());
  await page.getByLabel("Age", { exact: true }).fill("30");
  await page.getByLabel("Height (cm)").fill("180");
  await page.getByLabel("Current weight (kg)").fill("80");
  await page.getByLabel("Goal weight (kg)").fill("85");
  await page.getByRole("button", { name: "Let’s get started" }).click();
  await expect(
    page.getByRole("heading", { name: "Let’s make it count, Test." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log food", exact: true }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.getByLabel("Food name", { exact: true }).fill("Test oats");
  await page.getByLabel("calories (kcal)", { exact: true }).fill("380");
  await page.getByLabel("protein (g)", { exact: true }).fill("13");
  await page.getByLabel("carbs (g)", { exact: true }).fill("60");
  await page.getByLabel("fat (g)", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Add to meal", exact: true }).click();
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await expect(page.getByText("Test oats", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Weigh in", exact: true }).click();
  await page.getByLabel("Weight (kg)", { exact: true }).fill("80.2");
  await page.getByRole("button", { name: "Save weigh-in" }).click();
  await page.getByRole("button", { name: "Training", exact: true }).click();
  await page
    .getByRole("button", { name: "Log a workout", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Push", exact: true }).click();
  await page
    .getByRole("button", { name: "Complete workout", exact: true })
    .click();
  await expect(page.getByText("Push", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Training", exact: true }).click();
  await expect(page.getByText("Push", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Daily fuel" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
  await page.request.delete('/api/account',{headers:{'X-Bulkbro-Client':'1'},data:{password:'a-strong-test-password'}});
});
