import { networkInterfaces } from "node:os";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const addresses = Object.values(networkInterfaces())
  .flatMap((items) => items || [])
  .filter((item) => item.family === "IPv4" && !item.internal)
  .map((item) => item.address);
const address =
  addresses.find((item) => item.startsWith("192.168.")) ||
  addresses.find((item) => item.startsWith("10.")) ||
  addresses.find((item) => /^172\.(1[6-9]|2\d|3[01])\./.test(item));
if (!address) throw new Error("Connect this computer to a private network first.");

const url = `http://${address}:5191/`;
for (const path of ["", "api/health"]) {
  const response = await fetch(url + path, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${url + path} returned ${response.status}`);
}

const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Android", "Sdk")
    : undefined);
if (!sdk || !existsSync(sdk)) {
  throw new Error("Android SDK not found. Install it with Android Studio.");
}
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  BULKBRO_MOBILE_DEV_URL: url,
};
const windowsJdk21 = "C:\\Program Files\\Java\\jdk-21";
if (process.platform === "win32" && existsSync(windowsJdk21)) {
  env.JAVA_HOME = windowsJdk21;
}
function run(file, args, cwd = process.cwd()) {
  const result = spawnSync(file, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!process.env.npm_execpath) throw new Error("Run through npm run mobile:android:dev.");
run(process.execPath, [process.env.npm_execpath, "run", "build"]);
run(process.execPath, [resolve("node_modules/@capacitor/cli/bin/capacitor"), "sync", "android"]);
if (process.platform === "win32") {
  run("cmd.exe", ["/d", "/s", "/c", "gradlew.bat", "assembleDebug"], "android");
} else {
  run("./gradlew", ["assembleDebug"], "android");
}

const apk = resolve("android/app/build/outputs/apk/debug/app-debug.apk");
if (!existsSync(apk)) throw new Error(`Gradle did not produce ${apk}`);
mkdirSync("artifacts", { recursive: true });
const output = join("artifacts", "bulkbro-android-dev.apk");
copyFileSync(apk, output);
console.log(`\nAndroid development app: ${resolve(output)}`);
console.log(`Live app URL: ${url}`);
console.log("Keep npm run dev and npm run dev:mobile running while using this build.");
