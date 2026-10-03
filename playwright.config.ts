import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5188",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  workers: 1,
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5188",
    reuseExistingServer: true,
    timeout: 60000,
  },
  reporter: "list",
});
