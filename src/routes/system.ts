import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";

const HealthSchema = z.object({ status: z.literal("ok"), version: z.string() }).openapi("Health");

const health = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness check; it does not touch Firestore",
  responses: {
    200: { description: "The API runs", content: { "application/json": { schema: HealthSchema } } },
  },
});

export const systemRoutes = (version: string) =>
  new OpenAPIHono<AppEnv>().openapi(health, (c) => c.json({ status: "ok" as const, version }, 200));
