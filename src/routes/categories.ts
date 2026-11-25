import { OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import type { Ledger } from "../ledger/service.ts";
import { CategoryCreateSchema, CategoryPatchSchema, CategorySchema } from "../schemas/ledger.ts";
import type { Store } from "../store/types.ts";
import { validationHook } from "./hook.ts";
import { crudRoutes } from "./openapi.ts";

const categories = crudRoutes("Categories", "/categories", {
  item: CategorySchema,
  create: CategoryCreateSchema,
  patch: CategoryPatchSchema,
});

export const categoriesRoutes = (store: Store, ledger: Ledger) => {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app
    .openapi(categories.list, async (c) => c.json(await ledger.categories(c.var.user.uid), 200))
    .openapi(categories.create, async (c) => {
      const { uid } = c.var.user;
      const input = c.req.valid("json") as z.infer<typeof CategoryCreateSchema>;
      const at = ledger.stamp();
      const count = (await ledger.categories(uid)).length;
      const category = await store.categories.create(uid, {
        ...input,
        key: null,
        order: input.order ?? count,
        archived: false,
        createdAt: at,
        updatedAt: at,
      });
      return c.json(category, 201);
    })
    .openapi(categories.read, async (c) => {
      const { id } = c.req.valid("param");
      const category = await store.categories.get(c.var.user.uid, id);
      if (!category) throw notFound("category", id);
      return c.json(category, 200);
    })
    .openapi(categories.patch, async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json") as z.infer<typeof CategoryPatchSchema>;
      const saved = await store.categories.update(c.var.user.uid, id, {
        ...patch,
        updatedAt: ledger.stamp(),
      });
      if (!saved) throw notFound("category", id);
      return c.json(saved, 200);
    })
    .openapi(categories.remove, async (c) => {
      const { uid } = c.var.user;
      const { id } = c.req.valid("param");
      if (!(await store.categories.get(uid, id))) throw notFound("category", id);
      if (await store.transactions.uses(uid, "categoryId", id)) {
        throw new ApiError("conflict", "The category has transactions: archive it instead");
      }
      if ((await store.budgets.list(uid)).some((budget) => budget.categoryId === id)) {
        throw new ApiError("conflict", "The category has a budget: delete the budget first");
      }
      await store.categories.remove(uid, id);
      return c.body(null, 204);
    });

  return app;
};
