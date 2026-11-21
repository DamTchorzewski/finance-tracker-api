import { createApp } from "../app.ts";
import { readEnv, type Env } from "../env.ts";
import type { AuthUser, TokenVerifier } from "../lib/auth.ts";
import { MemoryRateCache } from "../rates/cache.ts";
import { RatesService } from "../rates/service.ts";
import { memoryStore } from "../store/memory.ts";
import type { Store } from "../store/types.ts";

/** Tokens the fake verifier knows: "token-<uid>" (confirmed e-mail) and "unverified-<uid>". */
export const fakeVerifier: TokenVerifier = {
  verify(token) {
    const [kind, uid] = token.split("-");
    if (!uid || (kind !== "token" && kind !== "unverified")) {
      return Promise.reject(new Error("bad token"));
    }
    const user: AuthUser = {
      uid,
      email: `${uid}@example.com`,
      name: uid,
      emailVerified: kind === "token",
    };
    return Promise.resolve(user);
  },
};

export function testApp(
  overrides: Partial<Env> = {},
  store: Store = memoryStore(),
  rates: RatesService = new RatesService({
    fetcher: () => Promise.reject(new Error("no network in tests")),
    cache: new MemoryRateCache(),
  }),
) {
  const env = { ...readEnv({}), ...overrides };
  const app = createApp({ env, store, rates, verifier: fakeVerifier });

  const request = (
    path: string,
    init: RequestInit & { token?: string | null; json?: unknown } = {},
  ) => {
    const { token = "token-alice", json, headers, ...rest } = init;
    const all = new Headers(headers);
    if (token) all.set("Authorization", `Bearer ${token}`);
    if (json !== undefined) all.set("Content-Type", "application/json");
    return app.request(path, {
      ...rest,
      headers: all,
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
  };

  return { app, store, request };
}
