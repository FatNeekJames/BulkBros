import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
const origin = "http://localhost:5190";
const server = spawn(process.execPath, ["build/server.mjs"], {
  env: {
    ...process.env,
    PORT: "5190",
    APP_ORIGIN: origin,
    DATABASE_PATH: "./test-results/pwa.sqlite",
    NODE_ENV: "development",
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk));
server.stderr.on("data", (chunk) => (serverOutput += chunk));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("Test server did not start: " + serverOutput);
  browser = await chromium.launch();
  const context = await browser.newContext();
  const headers = { "X-Bulkbro-Client": "1" };
  const suffix = Date.now();
  const register = await context.request.post(origin + "/api/auth/register", {
    headers,
    data: {
      email: `pwa-${suffix}@example.test`,
      password: "a-strong-test-password",
    },
  });
  expect(register.status()).toBe(201);
  const profile = await context.request.put(origin + "/api/profile", {
    headers,
    data: {
      name: "PWA Test",
      username: `pwa_${suffix}`,
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
  expect(profile.status()).toBe(200);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  try {
    await expect(
      page.getByRole("heading", { name: "Daily fuel" }),
    ).toBeVisible();
  } catch (e) {
    console.log(
      JSON.stringify({
        url: page.url(),
        title: await page.title(),
        text: (await page.locator("body").innerText()).slice(0, 400),
        errors,
      }),
    );
    throw e;
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Daily fuel" })).toBeVisible();
  await page.getByRole("button", { name: "Weigh in", exact: true }).click();
  await page.getByLabel("Weight (kg)", { exact: true }).fill("80.5");
  await page.getByRole("button", { name: "Save weigh-in" }).click();
  await expect(page.getByText(/1 entries waiting to sync/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/1 entries waiting to sync/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/1 entries waiting to sync/)).toHaveCount(0);
  const snapshot = await (
    await context.request.get(origin + "/api/snapshot")
  ).json();
  expect(snapshot.weights).toHaveLength(1);
  expect(snapshot.weights[0].weight).toBe(80.5);
  expect(errors).toEqual([]);
  await context.request.delete(origin + "/api/account", {
    headers,
    data: { password: "a-strong-test-password" },
  });
  console.log(
    "PASS: built app, service-worker offline reload, queued weigh-in persistence and reconnect sync.",
  );
} finally {
  await browser?.close();
  server.kill();
}
