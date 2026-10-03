import type { RequestHandler } from "express";
import { isIP } from "node:net";

export function trustLocalProxy(address: string, hop: number): boolean {
  return (
    hop === 0 && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)
  );
}

// The local proxy must overwrite X-Forwarded-For with its socket peer's IP.
// No additional forwarded hops or alternative identity headers are accepted.
export const sanitizeForwarding: RequestHandler = (req, _res, next) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (
    !trustLocalProxy(req.socket.remoteAddress ?? "", 0) ||
    typeof forwardedFor !== "string" ||
    !isIP(forwardedFor)
  ) {
    delete req.headers["x-forwarded-for"];
  }
  delete req.headers.forwarded;
  next();
};
