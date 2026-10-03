import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { createServer, type ViteDevServer } from "vite";
import { apiProxy, clientFileAccess } from "../scripts/vite-security";

let server: ViteDevServer | undefined;
let root: string | undefined;
const privateMarker = "synthetic-private-database-marker";
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
function fixture() {
  root = mkdtempSync(join(tmpdir(), "bulkbro-private-files-"));
  for (const name of ["data", "backups", "src", "shared", "public"])
    mkdirSync(join(root, name));
  symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
  writeFileSync(
    join(root, "index.html"),
    '<main>Fixture client</main><script type="module" src="/src/main.ts"></script>',
  );
  writeFileSync(join(root, "src/main.ts"), 'console.log("fixture client");');
  writeFileSync(
    join(root, "public/icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  );
  for (const file of [
    "data/bulkbro.sqlite",
    "data/bulkbro.sqlite-wal",
    "data/bulkbro.sqlite-shm",
    "backups/private.backup",
    ".env.local",
    "public/leaked.sqlite",
  ])
    writeFileSync(join(root, file), privateMarker);
  symlinkSync(join(root, "data/bulkbro.sqlite"), join(root, "src/alias.txt"));
  symlinkSync(
    join(root, "data/bulkbro.sqlite-wal"),
    join(root, "public/alias.txt"),
  );
  return root;
}
async function start(
  root: string,
  proxy?: ReturnType<typeof apiProxy>,
  protect = true,
) {
  const access = clientFileAccess(root, "data/bulkbro.sqlite");
  server = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, "test-cache"),
    plugins: protect ? [access.plugin] : [],
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      fs: protect ? access.fs : undefined,
      proxy: proxy ? { "/api": proxy } : undefined,
    },
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  return `http://127.0.0.1:${address.port}`;
}

describe("development file boundary", () => {
  it("blocks database copies, sidecars, public files and symlink/raw aliases while serving the client", async () => {
    const dir = fixture();
    // Reproduce the previous default Vite policy against synthetic data only.
    const previous = await start(dir, undefined, false);
    expect(await (await fetch(previous + "/data/bulkbro.sqlite")).text()).toBe(
      privateMarker,
    );
    await server!.close();
    const origin = await start(dir);
    for (const path of [
      "/data/bulkbro.sqlite",
      "/data/bulkbro.sqlite-wal",
      "/data/bulkbro.sqlite-shm",
      "/%64ata/bulkbro.sqlite?raw",
      "/data%2fbulkbro.sqlite?import",
      `/@fs/${join(dir, "data/bulkbro.sqlite")}`,
      `/@fs/${join(dir, "src/alias.txt").slice(1)}`,
      `/@fs/${join(dir, "data/bulkbro.sqlite-wal")}?raw`,
      "/backups/private.backup",
      "/.env.local",
      "/leaked.sqlite",
      "/src/alias.txt?raw",
      "/alias.txt",
    ]) {
      const response = await fetch(origin + path);
      expect(response.status, path).toBe(403);
      expect(await response.text(), path).not.toContain(privateMarker);
    }
    for (const path of ["/", "/src/main.ts", "/icon.svg", "/@vite/client"])
      expect((await fetch(origin + path)).status, path).toBe(200);
  });
  it("rejects extensionless configured databases under public/client roots, including symlink parents", () => {
    const dir = fixture();
    expect(() => clientFileAccess(dir, "public/account-store")).toThrow(
      "DATABASE_PATH must be outside",
    );
    expect(() => clientFileAccess(dir, "src/account-store")).toThrow(
      "DATABASE_PATH must be outside",
    );
    symlinkSync(join(dir, "public"), join(dir, "public-link"), "dir");
    expect(() => clientFileAccess(dir, "public-link/account-store")).toThrow(
      "DATABASE_PATH must be outside",
    );
    expect(() =>
      clientFileAccess(dir, "data/extensionless-store"),
    ).not.toThrow();
  });
  it("blocks a module import of a private symlink, not just a direct raw request", async () => {
    const dir = fixture();
    writeFileSync(
      join(dir, "src/main.ts"),
      'import data from "./alias.txt?raw"; console.log(data);',
    );
    const origin = await start(dir);
    const response = await fetch(origin + "/src/alias.txt?import&raw");
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(privateMarker);
    await expect(
      server!.transformRequest("/src/alias.txt?raw"),
    ).rejects.toThrow();
  });
});

it("the owned proxy replaces spoofed forwarding headers with the actual socket peer", async () => {
  const upstream = createHttpServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        forwarded: req.headers.forwarded,
        ip: req.headers["x-forwarded-for"],
        real: req.headers["x-real-ip"],
        host: req.headers["x-forwarded-host"],
        proto: req.headers["x-forwarded-proto"],
      }),
    );
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  try {
    const address = upstream.address();
    if (!address || typeof address === "string")
      throw new Error("No API fixture port");
    const origin = await start(
      fixture(),
      apiProxy(`http://127.0.0.1:${address.port}`),
    );
    for (const spoof of ["203.0.113.9", "203.0.113.10, 192.0.2.1"]) {
      const response = await fetch(origin + "/api/identity", {
        headers: {
          "X-Forwarded-For": spoof,
          Forwarded: `for=${spoof}`,
          "X-Real-IP": spoof,
          "X-Forwarded-Host": "evil.test",
          "X-Forwarded-Proto": "https",
        },
      });
      expect(await response.json()).toEqual({ ip: "127.0.0.1" });
    }
  } finally {
    await new Promise<void>((done, reject) =>
      upstream.close((error) => (error ? reject(error) : done())),
    );
  }
});
