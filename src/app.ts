import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./env.ts";
import { requireUser, type AppEnv, type TokenVerifier } from "./lib/auth.ts";
import { handleError, sendError } from "./lib/errors.ts";
import { byAddress, rateLimit } from "./lib/rate-limit.ts";
import type { RatesService } from "./rates/service.ts";
import { Ledger } from "./ledger/service.ts";
import { goalsRoutes } from "./routes/goals.ts";
import { ledgerRoutes } from "./routes/ledger.ts";
import { meRoutes } from "./routes/me.ts";
import { ratesRoutes } from "./routes/rates.ts";
import { systemRoutes } from "./routes/system.ts";
import type { Store } from "./store/types.ts";

export interface Deps {
  env: Env;
  verifier: TokenVerifier;
  store: Store;
  rates: RatesService;
}

export const OPENAPI_INFO = {
  openapi: "3.1.0",
  info: {
    title: "Finance tracker API",
    version: "2.0.0",
    description:
      "The data of the signed-in user. Accounts and sign-in are Firebase Authentication: send the Firebase ID token " +
      "as `Authorization: Bearer <token>`. Amounts are integers in minor units (grosze, cents) with an ISO 4217 code.",
  },
  servers: [{ url: "/api" }],
};

/** Every route under these paths needs a signed-in user. */
const PRIVATE_PATHS = [
  "/me",
  "/accounts",
  "/categories",
  "/budgets",
  "/goals",
  "/transactions",
  "/import",
];

/** The API under /api: what Firebase Hosting rewrites to Cloud Run, and what runs locally. */
export function createApi({ env, verifier, store, rates }: Deps) {
  const api = new OpenAPIHono<AppEnv>();

  api.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "Firebase ID token",
  });

  api.route("/", systemRoutes(env.version));
  api.doc31("/openapi.json", OPENAPI_INFO);
  api.get("/docs", Scalar({ url: "/api/openapi.json", pageTitle: "Finance tracker API" }));

  // Public, limited per address: the rates are public data and the demo uses them without an account.
  api.use("/rates/*", rateLimit(env.rateLimitPerMinute, byAddress));
  api.route("/", ratesRoutes(rates));

  // Everything below needs a signed-in user.
  const signedIn = [requireUser(verifier, env), rateLimit(env.rateLimitPerMinute)] as const;
  // "/me/*" also matches "/me" itself, so one pattern per path (a second one would count each request twice)
  for (const path of PRIVATE_PATHS) api.use(`${path}/*`, ...signedIn);
  const ledger = new Ledger(store, rates);
  api.route("/", meRoutes(store));
  api.route("/", ledgerRoutes(store, ledger));
  api.route("/", goalsRoutes(store, ledger));

  return api;
}

export function createApp(deps: Deps) {
  const app = new OpenAPIHono();

  app.use(secureHeaders());
  if (deps.env.corsOrigins.length) {
    app.use("/api/*", cors({ origin: deps.env.corsOrigins, maxAge: 600 }));
  }
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => sendError(c, "payload_too_large", "The request body is too large"),
    }),
  );
  app.use("/api/*", async (c, next) => {
    await next();
    // user data must never be kept by Firebase Hosting's CDN or the browser
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "private, no-store");
  });

  app.route("/api", createApi(deps));
  app.notFound((c) => sendError(c, "not_found", "Not found"));
  app.onError(handleError);

  return app;
}
