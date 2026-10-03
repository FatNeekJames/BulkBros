import { networkInterfaces } from "node:os";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import QRCode from "qrcode";

const apk = resolve("artifacts/bulkbro-android-dev.apk");
if (!existsSync(apk)) {
  throw new Error("Build the app first with npm run mobile:android:dev.");
}
const addresses = Object.values(networkInterfaces())
  .flatMap((items) => items || [])
  .filter((item) => item.family === "IPv4" && !item.internal)
  .map((item) => item.address);
const address =
  addresses.find((item) => item.startsWith("192.168.")) ||
  addresses.find((item) => item.startsWith("10.")) ||
  addresses.find((item) => /^172\.(1[6-9]|2\d|3[01])\./.test(item));
if (!address) throw new Error("Connect to the same private network as your phone.");

const port = 5192;
const url = `http://${address}:${port}/`;
const server = createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  if (req.url === "/bulkbro-android-dev.apk") {
    res.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="bulkbro-android-dev.apk"',
      "Content-Length": statSync(apk).size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(apk).pipe(res);
    return;
  }
  if (req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#171a17"><title>Install BulkBro</title><style>body{margin:0;background:#171a17;color:#edf0e8;font:16px system-ui;padding:12vh 24px;text-align:center}main{max-width:420px;margin:auto}h1{font-size:38px}a{display:block;background:#bdff48;color:#171a17;padding:17px;border-radius:12px;font-weight:800;text-decoration:none;margin:30px 0}p{line-height:1.5;color:#bac2b3}</style><main><h1>BulkBro for Android</h1><p>Download the development app to this phone.</p><a href="/bulkbro-android-dev.apk">Download APK</a><p>Keep the computer and phone on the same network. The app needs the BulkBro development servers running on the computer.</p></main></html>`);
    return;
  }
  res.writeHead(404).end();
});
server.listen(port, "0.0.0.0", async () => {
  mkdirSync("test-results", { recursive: true });
  await QRCode.toFile("test-results/android-install-qr.png", url, {
    width: 520,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  console.log(`Android install page: ${url}`);
  console.log("Scan test-results/android-install-qr.png from your phone.");
  console.log("Keep this terminal running while downloading the APK.");
});
