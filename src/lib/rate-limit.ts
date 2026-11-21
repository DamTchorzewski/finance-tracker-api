import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./auth.ts";
import { ApiError } from "./errors.ts";

/**
 * A fixed one-minute window per signed-in user, kept in the memory of the instance. Cloud Run runs at most two
 * instances, so the real limit is at most twice the setting: enough to stop a runaway client, not an attacker.
 */
export const rateLimit = (perMinute: number, now: () => number = Date.now) => {
  const windows = new Map<string, { start: number; count: number }>();

  return createMiddleware<AppEnv>(async (c, next) => {
    const key = c.var.user.uid;
    const time = now();
    const current = windows.get(key);

    if (!current || time - current.start >= 60_000) {
      windows.set(key, { start: time, count: 1 });
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
