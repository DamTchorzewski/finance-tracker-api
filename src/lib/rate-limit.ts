import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./auth.ts";
import { ApiError } from "./errors.ts";

/** The signed-in user (after requireUser). */
export const byUser = (c: Context<AppEnv>) => c.var.user.uid;

/** The caller's address as Cloud Run and Firebase Hosting pass it (first X-Forwarded-For entry). */
export const byAddress = (c: Context) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

/**
 * A fixed one-minute window per key, kept in the memory of the instance. Cloud Run runs at most two instances, so
 * the real limit is at most twice the setting: enough to stop a runaway client, not an attacker.
 */
export const rateLimit = (
  perMinute: number,
  key: (c: Context<AppEnv>) => string = byUser,
  now: () => number = Date.now,
) => {
  const windows = new Map<string, { start: number; count: number }>();

  return createMiddleware<AppEnv>(async (c, next) => {
    const id = key(c);
    const time = now();
    const current = windows.get(id);

    if (!current || time - current.start >= 60_000) {
      windows.set(id, { start: time, count: 1 });
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (time - w.start >= 60_000) windows.delete(k);
      }
    } else if (++current.count > perMinute) {
      c.header("Retry-After", String(Math.ceil((current.start + 60_000 - time) / 1000)));
      throw new ApiError("rate_limited", "Too many requests, try again in a minute");
    }

    await next();
  });
};
