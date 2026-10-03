import type { CapacitorConfig } from "@capacitor/cli";

// Set only for a development build on a trusted local network. Release builds
// package the web assets and need a separately deployed HTTPS API.
const devServer = process.env.BULKBRO_MOBILE_DEV_URL;
if (devServer) {
  const url = new URL(devServer);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BULKBRO_MOBILE_DEV_URL must be an HTTP(S) URL");
  }
}

const config: CapacitorConfig = {
  appId: "app.bulkbro.tracker",
  appName: "BulkBro",
  webDir: "dist",
  backgroundColor: "#111411",
  server: devServer
    ? { url: devServer, cleartext: devServer.startsWith("http:") }
    : undefined,
};

export default config;
