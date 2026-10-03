import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import "dotenv/config";
import { config } from "dotenv";
import { apiProxy, clientFileAccess } from "./scripts/vite-security";
// Match backend precedence: process environment, then .env, then .env.local.
config({ path: ".env.local" });
const access = clientFileAccess(
  process.cwd(),
  process.env.DATABASE_PATH || "./data/bulkbro.sqlite",
);
export default defineConfig({
  plugins: [access.plugin, react()],
  server: {
    port: 5188,
    strictPort: true,
    fs: access.fs,
    proxy: { "/api": apiProxy("http://127.0.0.1:3001") },
  },
  build: {
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
  },
});
