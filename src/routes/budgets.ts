import { OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import type { Ledger } from "../ledger/service.ts";
import { BudgetCreateSchema, BudgetPatchSchema, BudgetSchema } from "../schemas/ledger.ts";
import type { Store } from "../store/types.ts";
import { validationHook } from "./hook.ts";
import { crudRoutes } from "./openapi.ts";

const budgets = crudRoutes("Budgets", "/budgets", {
  item: BudgetSchema,
  create: BudgetCreateSchema,
  patch: BudgetPatchSchema,
});

export const budgetsRoutes = (store: Store, ledger: Ledger) => {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app
    .openapi(budgets.list, async (c) => c.json(await store.budgets.list(c.var.user.uid), 200))
    .openapi(budgets.create, async (c) => {
      const { uid } = c.var.user;
      const input = c.req.valid("json") as z.infer<typeof BudgetCreateSchema>;
      const category = await store.categories.get(uid, input.categoryId);
      if (!category) throw notFound("category", input.categoryId);
      if (category.kind !== "expense")
        throw new ApiError("validation", "A budget is for an expense category");
      if (
        (await store.budgets.list(uid)).some((budget) => budget.categoryId === input.categoryId)
      ) {
        throw new ApiError("conflict", "The category already has a budget");
      }
      const currency = input.currency ?? (await ledger.baseCurrency(uid));
      const at = ledger.stamp();
      const budget = await store.budgets.create(uid, {
        ...input,
        currency,
        createdAt: at,
        updatedAt: at,
      });
      return c.json(budget, 201);
    })
    .openapi(budgets.read, async (c) => {
      const { id } = c.req.valid("param");
      const budget = await store.budgets.get(c.var.user.uid, id);
      if (!budget) throw notFound("budget", id);
      return c.json(budget, 200);
    })
    .openapi(budgets.patch, async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json") as z.infer<typeof BudgetPatchSchema>;
      const saved = await store.budgets.update(c.var.user.uid, id, {
        ...patch,
        updatedAt: ledger.stamp(),
      });
      if (!saved) throw notFound("budget", id);
      return c.json(saved, 200);
    })
    .openapi(budgets.remove, async (c) => {
      const { id } = c.req.valid("param");
      if (!(await store.budgets.remove(c.var.user.uid, id))) throw notFound("budget", id);
      return c.body(null, 204);
    });

  return app;
};
