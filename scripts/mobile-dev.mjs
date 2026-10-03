import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import QRCode from "qrcode";

const addresses = Object.entries(networkInterfaces()).flatMap(
  ([name, entries]) =>
    (entries || [])
      .filter((e) => e.family === "IPv4" && !e.internal)
      .map((e) => ({ name, address: e.address })),
);
const privateAddress =
  addresses.find((e) => e.address.startsWith("192.168.")) ||
  addresses.find((e) => e.address.startsWith("10.")) ||
  addresses.find((e) => /^172\.(1[6-9]|2[0-9]|3[01])\./.test(e.address));
if (!privateAddress) {
  console.error(
    "No private LAN address was found. Connect this computer to the same Wi-Fi or network as your phone.",
  );
  process.exit(1);
}
const url = `http://${privateAddress.address}:5191/`;
const child = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "0.0.0.0",
    "--port",
    "5191",
    "--strictPort",
  ],
  { stdio: "inherit", windowsHide: true },
);
const stop = () => {
  child.kill();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 1));
let ready = false;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    const health = await fetch(url + "api/health", {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok && health.ok) {
      ready = true;
      break;
    }
  } catch {}
  if (child.exitCode !== null) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) {
  console.error(
    "Mobile preview did not become reachable. Check that the API is running on port 3001 and port 5191 is free.",
  );
  child.kill();
  process.exit(1);
}
mkdirSync("test-results", { recursive: true });
await QRCode.toFile("test-results/mobile-qr.png", url, {
  width: 520,
  margin: 2,
  errorCorrectionLevel: "M",
});
console.log(
  `\nMobile preview: ${url}\nConnect your phone to the same Wi-Fi/network and scan test-results/mobile-qr.png.\nKeep this terminal running while testing.\n`,
);
