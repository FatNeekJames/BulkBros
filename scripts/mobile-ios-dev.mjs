import { networkInterfaces } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const addresses = Object.values(networkInterfaces())
  .flatMap((items) => items || [])
  .filter((item) => item.family === "IPv4" && !item.internal)
  .map((item) => item.address);
const address =
  addresses.find((item) => item.startsWith("192.168.")) ||
  addresses.find((item) => item.startsWith("10.")) ||
  addresses.find((item) => /^172\.(1[6-9]|2\d|3[01])\./.test(item));
const url =
  process.env.BULKBRO_MOBILE_DEV_URL ||
  (address ? `http://${address}:5191/` : undefined);
if (!url) throw new Error("Set BULKBRO_MOBILE_DEV_URL to the local app URL.");
const target = new URL(url);
if (!["http:", "https:"].includes(target.protocol)) {
  throw new Error("BULKBRO_MOBILE_DEV_URL must use HTTP(S).");
}
for (const path of ["", "api/health"]) {
  const response = await fetch(new URL(path, url), {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${path || "app"} returned ${response.status}`);
}

const env = { ...process.env, BULKBRO_MOBILE_DEV_URL: url };
function run(file, args) {
  const result = spawnSync(file, args, {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!process.env.npm_execpath) throw new Error("Run through npm run mobile:ios:dev.");
run(process.execPath, [process.env.npm_execpath, "run", "build"]);
run(process.execPath, [resolve("node_modules/@capacitor/cli/bin/capacitor"), "sync", "ios"]);
console.log(`\niPhone development project is ready: ios/App/App.xcodeproj`);
console.log(`Live app URL: ${url}`);
console.log("Open the Xcode project on a Mac to sign and install it on an iPhone.");
