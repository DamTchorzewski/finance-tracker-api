import { OpenAPIHono, createRoute, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";
import { addDays, daysBetween, todayInWarsaw } from "../lib/dates.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import type { Ledger } from "../ledger/service.ts";
import {
  TransactionCreateSchema,
  TransactionPatchSchema,
  TransactionQuerySchema,
  TransactionSchema,
} from "../schemas/ledger.ts";
import type { Store } from "../store/types.ts";
import { validationHook } from "./hook.ts";
import { crudRoutes, errors } from "./openapi.ts";

const MAX_RANGE_DAYS = 400;

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

export const transactionsRoutes = (store: Store, ledger: Ledger) => {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

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

  return app;
};
