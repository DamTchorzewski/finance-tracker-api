import { OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { withBalance, type Ledger } from "../ledger/service.ts";
import { AccountCreateSchema, AccountPatchSchema, AccountSchema } from "../schemas/ledger.ts";
import type { Store } from "../store/types.ts";
import { validationHook } from "./hook.ts";
import { crudRoutes } from "./openapi.ts";

const accounts = crudRoutes("Accounts", "/accounts", {
  item: AccountSchema,
  create: AccountCreateSchema,
  patch: AccountPatchSchema,
});

export const accountsRoutes = (store: Store, ledger: Ledger) => {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app
    .openapi(accounts.list, async (c) => c.json(await ledger.accounts(c.var.user.uid), 200))
    .openapi(accounts.create, async (c) => {
      const { uid } = c.var.user;
      const input = c.req.valid("json") as z.infer<typeof AccountCreateSchema>;
      const at = ledger.stamp();
      const count = (await store.accounts.list(uid)).length;
      const account = await store.accounts.create(uid, {
        ...input,
        order: input.order ?? count,
        flowMinor: 0,
        archived: false,
        createdAt: at,
        updatedAt: at,
      });
      return c.json(withBalance(account), 201);
    })
    .openapi(accounts.read, async (c) => {
      const { id } = c.req.valid("param");
      return c.json(withBalance(await ledger.account(c.var.user.uid, id)), 200);
    })
    .openapi(accounts.patch, async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json") as z.infer<typeof AccountPatchSchema>;
      const saved = await store.accounts.update(c.var.user.uid, id, {
        ...patch,
        updatedAt: ledger.stamp(),
      });
      if (!saved) throw notFound("account", id);
      return c.json(withBalance(saved), 200);
    })
    .openapi(accounts.remove, async (c) => {
      const { uid } = c.var.user;
      const { id } = c.req.valid("param");
      await ledger.account(uid, id);
      if (
        (await store.transactions.uses(uid, "accountId", id)) ||
        (await store.transactions.uses(uid, "toAccountId", id))
      ) {
        throw new ApiError("conflict", "The account has transactions: archive it instead");
      }
      await store.accounts.remove(uid, id);
      return c.body(null, 204);
    });

  return app;
};
