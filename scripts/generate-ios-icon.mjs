import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/icon.svg", "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0;background:#171a17">${svg}</body></html>`,
  );
  await page.locator("svg").evaluate((element) => {
    element.setAttribute("width", "1024");
    element.setAttribute("height", "1024");
    element.style.display = "block";
  });
  await page.locator("svg").screenshot({
    path: "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  });
  console.log("BulkBro iOS app icon updated from public/icon.svg");
} finally {
  await browser.close();
}
