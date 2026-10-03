import { existsSync, realpathSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type { Plugin, ProxyOptions } from "vite";

function canonicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path
    ? path
    : resolve(canonicalPath(parent), basename(path));
}

function within(path: string, directory: string): boolean {
  const suffix = relative(directory, path);
  return (
    !suffix ||
    (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix))
  );
}

/** Serve only client code/assets; runtime storage never belongs to a web root. */
export function clientFileAccess(root: string, databasePath: string) {
  const sourceDirectories = ["src", "shared", "public", "node_modules"].map(
    (name) => resolve(root, name),
  );
  const directories = sourceDirectories.map(canonicalPath);
  const index = canonicalPath(resolve(root, "index.html"));
  const database =
    databasePath === ":memory:"
      ? null
      : canonicalPath(resolve(root, databasePath));
  const clientPath = (path: string) =>
    path === index || directories.some((dir) => within(path, dir));
  if (database && clientPath(database))
    throw new Error(
      "DATABASE_PATH must be outside client source and public asset directories. Keep the existing database in a private directory such as data/.",
    );

  const denied = (path: string) => {
    const normalized = path.replaceAll("\\", "/");
    return (
      /(?:^|\/)\.env(?:\.[^/]*)?$|\.(?:crt|pem)$|(?:^|\/)\.git(?:\/|$)|(?:^|\/)(?:data|backups)(?:\/|$)|\.(?:sqlite(?:3)?|db)(?:[-.].*)?$/i.test(
        normalized,
      ) ||
      (database !== null &&
        (path === database || path.startsWith(`${database}-`)))
    );
  };
  const allowed = (file: string) => {
    const real = canonicalPath(file);
    return clientPath(real) && !denied(file) && !denied(real);
  };
  const plugin: Plugin = {
    name: "bulkbro-private-files",
    enforce: "pre",
    configureServer(server) {
      // Vite's public middleware bypasses server.fs checks. Guard it too, and
      // check symlink targets before raw/import transformations can read them.
      server.middlewares.use((req, res, next) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent((req.url || "/").split("?")[0]);
          if (pathname.includes("\0")) throw new Error("Invalid path");
        } catch {
          res.statusCode = 400;
          res.end("Invalid path");
          return;
        }
        const files = pathname.startsWith("/@fs/")
          ? [resolve(sep, pathname.slice(5))]
          : [
              resolve(root, `.${pathname}`),
              resolve(root, "public", `.${pathname}`),
            ];
        if (
          files.some(
            (file) =>
              existsSync(file) && statSync(file).isFile() && !allowed(file),
          )
        ) {
          res.statusCode = 403;
          res.end("Private files are not available through the preview.");
          return;
        }
        next();
      });
    },
    load(id) {
      const path = id.split("?")[0];
      if (isAbsolute(path) && existsSync(path) && !allowed(path))
        this.error("Private files cannot be imported by the client.");
    },
  };
  return {
    plugin,
    fs: {
      strict: true,
      allow: [
        ...new Set([
          ...sourceDirectories,
          ...directories,
          resolve(root, "index.html"),
          index,
        ]),
      ],
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/data/**",
        "**/backups/**",
        "**/*.{sqlite,sqlite3,db}",
        "**/*.{sqlite,sqlite3,db}[-.]*",
        ...(database ? [database, `${database}-*`] : []),
      ],
    },
  };
}

/** One owned proxy hop supplies exactly the socket peer, never forwarded input. */
export function apiProxy(target: string): ProxyOptions {
  return {
    target,
    configure(proxy) {
      proxy.on("proxyReq", (outgoing, incoming) => {
        for (const header of [
          "forwarded",
          "x-real-ip",
          "x-forwarded-for",
          "x-forwarded-host",
          "x-forwarded-proto",
        ])
          outgoing.removeHeader(header);
        if (incoming.socket.remoteAddress)
          outgoing.setHeader("X-Forwarded-For", incoming.socket.remoteAddress);
      });
    },
  };
}
