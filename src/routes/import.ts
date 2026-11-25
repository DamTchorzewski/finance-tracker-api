import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";
import type { Ledger } from "../ledger/service.ts";
import { AccountSchema } from "../schemas/ledger.ts";
import { validationHook } from "./hook.ts";
import { errors, json, security } from "./openapi.ts";

const ImportResultSchema = z
  .object({ imported: z.number().int(), skipped: z.number().int(), account: AccountSchema })
  .openapi("ImportResult");
const importV1 = createRoute({
  method: "post",
  path: "/import/v1",
  tags: ["Import"],
  security,
  summary:
    "Copy the transactions of version 1 (personal-finance-manager) once into a new PLN account",
  responses: { 201: json(ImportResultSchema, "Imported"), ...errors("conflict") },
});

export const importRoutes = (ledger: Ledger) => {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app.openapi(importV1, async (c) => c.json(await ledger.importV1(c.var.user.uid), 201));

  return app;
};
