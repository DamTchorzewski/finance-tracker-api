import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "./schemas/profile.ts";
import { testApp } from "./test/helpers.ts";

describe("system", () => {
  it("answers the health check without a token", async () => {
    const { request } = testApp({ version: "rev-1" });
    const res = await request("/api/health", { token: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "rev-1" });
  });

  it("publishes an OpenAPI 3.1 document with the routes and the bearer scheme", async () => {
    const { request } = testApp();
    const doc = (await (await request("/api/openapi.json", { token: null })).json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/health", "/me", "/me/profile"]),
    );
    expect(doc.components.securitySchemes).toHaveProperty("bearerAuth");
  });

  it("answers an unknown route with the error shape and no-store", async () => {
    const { request } = testApp();
    const res = await request("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
  });

  it("sends the security headers", async () => {
    const { request } = testApp();
    const res = await request("/api/health", { token: null });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("allows only the configured origins", async () => {
    const { request } = testApp({ corsOrigins: ["http://localhost:5173"] });
    const ok = await request("/api/health", {
      token: null,
      headers: { Origin: "http://localhost:5173" },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const other = await request("/api/health", {
      token: null,
      headers: { Origin: "https://evil.test" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("sign-in", () => {
  it("rejects a request without a token", async () => {
    const res = await testApp().request("/api/me", { token: null });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("rejects a token the verifier does not accept", async () => {
    const res = await testApp().request("/api/me", { token: "forged" });
    expect(res.status).toBe(401);
  });

  it("rejects an unconfirmed e-mail unless the setting allows it", async () => {
    expect((await testApp().request("/api/me", { token: "unverified-bob" })).status).toBe(403);
    const relaxed = testApp({ requireVerifiedEmail: false });
    expect((await relaxed.request("/api/me", { token: "unverified-bob" })).status).toBe(200);
  });

  it("limits the requests per user and minute", async () => {
    const { request } = testApp({ rateLimitPerMinute: 2 });
    expect((await request("/api/me")).status).toBe(200);
    expect((await request("/api/me")).status).toBe(200);
    const limited = await request("/api/me");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await request("/api/me", { token: "token-carol" })).status).toBe(200);
  });
});

describe("profile", () => {
  it("returns the user and the default profile on the first visit", async () => {
    const res = await testApp().request("/api/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { uid: "alice", email: "alice@example.com", name: "alice", emailVerified: true },
      profile: DEFAULT_PROFILE,
    });
  });

  it("saves only the fields that are sent and keeps them per user", async () => {
    const { request } = testApp();
    const res = await request("/api/me/profile", {
      method: "PATCH",
      json: { baseCurrency: "EUR", monthStartDay: 10 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      baseCurrency: "EUR",
      monthStartDay: 10,
      locale: "pl",
    });

    const me = (await (await request("/api/me")).json()) as { profile: { baseCurrency: string } };
    expect(me.profile.baseCurrency).toBe("EUR");
    const other = (await (await request("/api/me", { token: "token-bob" })).json()) as {
      profile: { baseCurrency: string };
    };
    expect(other.profile.baseCurrency).toBe("PLN");
  });

  it("refuses wrong values with one issue per field", async () => {
    const res = await testApp().request("/api/me/profile", {
      method: "PATCH",
      json: { baseCurrency: "zloty", monthStartDay: 31 },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; issues: { path: string }[] } };
    expect(body.error.code).toBe("validation");
    expect(body.error.issues.map((issue) => issue.path).sort()).toEqual([
      "baseCurrency",
      "monthStartDay",
    ]);
  });

  it("refuses unknown fields and an empty change", async () => {
    const { request } = testApp();
    expect(
      (await request("/api/me/profile", { method: "PATCH", json: { admin: true } })).status,
    ).toBe(400);
    expect((await request("/api/me/profile", { method: "PATCH", json: {} })).status).toBe(400);
  });

  it("refuses a body over the size limit", async () => {
    const res = await testApp().request("/api/me/profile", {
      method: "PATCH",
      json: { displayName: "x".repeat(300 * 1024) },
    });
    expect(res.status).toBe(413);
  });
});
