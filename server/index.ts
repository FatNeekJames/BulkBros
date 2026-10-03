import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import express from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { openDatabase } from "./db";
import { createApp } from "./app";
const app = createApp(
  openDatabase(process.env.DATABASE_PATH || "./data/bulkbro.sqlite"),
);
if (existsSync("dist/index.html")) {
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
}
app.listen(Number(process.env.PORT) || 3001, "127.0.0.1", () =>
  console.log(
    "BulkBro API running on http://localhost:" + (process.env.PORT || 3001),
  ),
);
