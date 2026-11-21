import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";
import { addDays, daysBetween, todayInWarsaw } from "../lib/dates.ts";
import { ApiError, errorResponses } from "../lib/errors.ts";
import { withBalance, type Ledger } from "../ledger/service.ts";
import { IdParam } from "../schemas/common.ts";
import {
  AccountCreateSchema,
  AccountPatchSchema,
  AccountSchema,
  BudgetCreateSchema,
  BudgetPatchSchema,
  BudgetSchema,
  CategoryCreateSchema,
  CategoryPatchSchema,
  CategorySchema,
  TransactionCreateSchema,
  TransactionPatchSchema,
  TransactionQuerySchema,
  TransactionSchema,
} from "../schemas/ledger.ts";
import { DEFAULT_PROFILE } from "../schemas/profile.ts";
import type { Store } from "../store/types.ts";
import { validationHook } from "./hook.ts";

const security = [{ bearerAuth: [] }];
const MAX_RANGE_DAYS = 400;

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const errors = (...extra: Parameters<typeof errorResponses>) =>
  errorResponses("unauthorized", "forbidden", "rate_limited", ...extra);

/** Five routes per resource: list, create, read, change, delete. */
function crudRoutes(
  tag: string,
  path: string,
  schemas: { item: z.ZodType; create: z.ZodType; patch: z.ZodType },
) {
  const tags = [tag];
  return {
    list: createRoute({
      method: "get",
      path,
      tags,
      security,
      summary: `List the ${tag.toLowerCase()}`,
      responses: { 200: json(z.array(schemas.item), "The list"), ...errors() },
    }),
    create: createRoute({
      method: "post",
      path,
      tags,
      security,
      summary: `Add one`,
      request: body(schemas.create),
      responses: {
        201: json(schemas.item, "Created"),
        ...errors("validation", "not_found", "conflict"),
      },
    }),
    read: createRoute({
      method: "get",
      path: `${path}/{id}`,
      tags,
      security,
      summary: "Read one",
      request: { params: IdParam },
      responses: { 200: json(schemas.item, "The item"), ...errors("not_found") },
    }),
    patch: createRoute({
      method: "patch",
      path: `${path}/{id}`,
      tags,
      security,
      summary: "Change some fields",
      request: { params: IdParam, ...body(schemas.patch) },
      responses: { 200: json(schemas.item, "Saved"), ...errors("validation", "not_found") },
    }),
    remove: createRoute({
      method: "delete",
      path: `${path}/{id}`,
      tags,
      security,
      summary: "Delete one",
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, ...errors("not_found", "conflict") },
    }),
  };
}

const accounts = crudRoutes("Accounts", "/accounts", {
  item: AccountSchema,
  create: AccountCreateSchema,
  patch: AccountPatchSchema,
});
const categories = crudRoutes("Categories", "/categories", {
  item: CategorySchema,
  create: CategoryCreateSchema,
  patch: CategoryPatchSchema,
});
const budgets = crudRoutes("Budgets", "/budgets", {
  item: BudgetSchema,
  create: BudgetCreateSchema,
  patch: BudgetPatchSchema,
});
const transactions = crudRoutes("Transactions", "/transactions", {
  item: TransactionSchema,
  create: TransactionCreateSchema,
  patch: TransactionPatchSchema,
});
const listTransactions = createRoute({
  ...transactions.list,
  summary: `Transactions between two days (at most ${MAX_RANGE_DAYS}), newest first, optionally filtered`,
  request: { query: TransactionQuerySchema },
  responses: { ...transactions.list.responses, ...errors("validation") },
});

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

const notFound = (what: string, id: string) => new ApiError("not_found", `No ${what} ${id}`);

export const ledgerRoutes = (store: Store, ledger: Ledger) => {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  // ---- accounts
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

  // ---- categories
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

  // ---- budgets
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
      const currency =
        input.currency ??
        (await store.profiles.get(uid))?.baseCurrency ??
        DEFAULT_PROFILE.baseCurrency;
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

  // ---- transactions
  app
    .openapi(listTransactions, async (c) => {
      const { uid } = c.var.user;
      const query = c.req.valid("query");
      const to = query.to ?? todayInWarsaw();
      const from = query.from ?? addDays(to, -90);
      if (from > to) throw new ApiError("validation", "`from` must not be after `to`");
      if (daysBetween(from, to) > MAX_RANGE_DAYS) {
        throw new ApiError("validation", `Ask for at most ${MAX_RANGE_DAYS} days`);
      }
      const text = query.q?.toLocaleLowerCase("pl");
      const items = (await store.transactions.listRange(uid, from, to)).filter(
        (tx) =>
          (!query.accountId ||
            tx.accountId === query.accountId ||
            tx.toAccountId === query.accountId) &&
          (!query.categoryId || tx.categoryId === query.categoryId) &&
          (!query.kind || tx.kind === query.kind) &&
          (!text ||
            [tx.note, tx.payee ?? "", ...tx.tags].some((field) =>
              field.toLocaleLowerCase("pl").includes(text),
            )),
      );
      return c.json(items, 200);
    })
    .openapi(transactions.create, async (c) => {
      const { uid } = c.var.user;
      const input = c.req.valid("json") as z.infer<typeof TransactionCreateSchema>;
      const prepared = await ledger.prepare(uid, input);
      return c.json(await store.transactions.create(uid, prepared), 201);
    })
    .openapi(transactions.read, async (c) => {
      const { id } = c.req.valid("param");
      const tx = await store.transactions.get(c.var.user.uid, id);
      if (!tx) throw notFound("transaction", id);
      return c.json(tx, 200);
    })
    .openapi(transactions.patch, async (c) => {
      const { uid } = c.var.user;
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json") as z.infer<typeof TransactionPatchSchema>;
      const current = await store.transactions.get(uid, id);
      if (!current) throw notFound("transaction", id);
      const merged = { ...current, ...patch };
      // a change of kind away from a transfer drops its other side
      const transfer = merged.kind === "transfer";
      const prepared = await ledger.prepare(
        uid,
        {
          accountId: merged.accountId,
          kind: merged.kind,
          amountMinor: merged.amountMinor,
          date: merged.date,
          categoryId: transfer ? null : merged.categoryId,
          note: merged.note,
          payee: merged.payee,
          tags: merged.tags,
          toAccountId: transfer ? merged.toAccountId : null,
          toAmountMinor:
            transfer && (patch.toAmountMinor !== undefined || !("amountMinor" in patch))
              ? merged.toAmountMinor
              : null,
        },
        current,
      );
      const saved = await store.transactions.replace(uid, id, prepared);
      if (!saved) throw notFound("transaction", id);
      return c.json(saved, 200);
    })
    .openapi(transactions.remove, async (c) => {
      const { id } = c.req.valid("param");
      if (!(await store.transactions.remove(c.var.user.uid, id))) throw notFound("transaction", id);
      return c.body(null, 204);
    });

  // ---- import
  app.openapi(importV1, async (c) => c.json(await ledger.importV1(c.var.user.uid), 201));

  return app;
};
