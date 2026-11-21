import { z } from "@hono/zod-openapi";
import { CurrencyCode, Id, IsoDate, Timestamp } from "./common.ts";

// ---- Accounts -------------------------------------------------------------------------------------------------

export const ACCOUNT_KINDS = ["cash", "bank", "savings", "card", "foreign"] as const;

export const AccountSchema = z
  .object({
    id: Id,
    name: z.string().trim().min(1).max(40),
    kind: z.enum(ACCOUNT_KINDS),
    currency: CurrencyCode,
    openingBalanceMinor: z.number().int(),
    /** The sum of every transaction's effect on the account, kept by the API on each write. */
    flowMinor: z.number().int(),
    /** openingBalanceMinor + flowMinor, in the account's currency. */
    balanceMinor: z.number().int(),
    archived: z.boolean(),
    order: z.number().int().min(0).max(999),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Account");

export type Account = z.infer<typeof AccountSchema>;
export type StoredAccount = Omit<Account, "balanceMinor">;

export const AccountCreateSchema = z
  .object({
    name: AccountSchema.shape.name,
    kind: AccountSchema.shape.kind,
    currency: CurrencyCode,
    openingBalanceMinor: z.number().int().default(0),
    order: AccountSchema.shape.order.optional(),
  })
  .strict()
  .openapi("AccountCreate");

export const AccountPatchSchema = z
  .object({
    name: AccountSchema.shape.name,
    kind: AccountSchema.shape.kind,
    openingBalanceMinor: z.number().int(),
    archived: z.boolean(),
    order: AccountSchema.shape.order,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Send at least one field")
  .openapi("AccountPatch");

// ---- Categories -----------------------------------------------------------------------------------------------

/** Colour tokens of the web app's palette, chosen to stay apart for colour-blind users. */
export const CATEGORY_COLOURS = [
  "sage",
  "teal",
  "sky",
  "indigo",
  "violet",
  "plum",
  "rose",
  "coral",
  "amber",
  "lime",
  "sand",
  "slate",
] as const;

export const CategorySchema = z
  .object({
    id: Id,
    /** Set on the seeded categories (groceries, salary, ...), so the app can translate them; null for own ones. */
    key: z.string().nullable(),
    name: z.string().trim().min(1).max(40),
    kind: z.enum(["expense", "income"]),
    /** A Lucide icon name. */
    icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
    colour: z.enum(CATEGORY_COLOURS),
    archived: z.boolean(),
    order: z.number().int().min(0).max(999),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Category");

export type Category = z.infer<typeof CategorySchema>;

export const CategoryCreateSchema = CategorySchema.pick({
  name: true,
  kind: true,
  icon: true,
  colour: true,
})
  .extend({ order: CategorySchema.shape.order.optional() })
  .strict()
  .openapi("CategoryCreate");

export const CategoryPatchSchema = CategorySchema.pick({
  name: true,
  icon: true,
  colour: true,
  archived: true,
  order: true,
})
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Send at least one field")
  .openapi("CategoryPatch");

// ---- Transactions ---------------------------------------------------------------------------------------------

export const RateSchema = z
  .object({
    /** pln = the amount is in PLN, no rate needed. */
    source: z.enum(["nbp-a", "ecb", "pln"]),
    /** The day of the table used. */
    date: IsoDate,
    /** PLN per 1 unit of the transaction's currency. */
    mid: z.number().positive(),
  })
  .openapi("FrozenRate");

export const TransactionSchema = z
  .object({
    id: Id,
    accountId: Id,
    kind: z.enum(["expense", "income", "transfer"]),
    /** Always positive; the kind says which way the money moved. In the account's currency. */
    amountMinor: z.number().int().positive(),
    currency: CurrencyCode,
    date: IsoDate,
    categoryId: Id.nullable(),
    note: z.string().max(200),
    payee: z.string().max(60).nullable(),
    tags: z.array(z.string().trim().min(1).max(24)).max(10),
    /** Transfers only: the account that receives the money and how much it receives (its currency). */
    toAccountId: Id.nullable(),
    toAmountMinor: z.number().int().positive().nullable(),
    /** The value in PLN at the rate of the transaction's day, frozen when it is saved. */
    plnMinor: z.number().int(),
    rate: RateSchema,
    origin: z.enum(["app", "import-v1", "csv"]),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Transaction");

export type Transaction = z.infer<typeof TransactionSchema>;

const transactionInput = {
  accountId: Id,
  kind: TransactionSchema.shape.kind,
  amountMinor: TransactionSchema.shape.amountMinor,
  date: IsoDate,
  categoryId: Id.nullable().default(null),
  note: TransactionSchema.shape.note.default(""),
  payee: TransactionSchema.shape.payee.default(null),
  tags: TransactionSchema.shape.tags.default([]),
  toAccountId: Id.nullable().default(null),
  toAmountMinor: TransactionSchema.shape.toAmountMinor.default(null),
};

export const TransactionCreateSchema = z
  .object(transactionInput)
  .strict()
  .openapi("TransactionCreate");

export type TransactionInput = z.infer<typeof TransactionCreateSchema>;

export const TransactionPatchSchema = z
  .object({
    accountId: Id,
    kind: TransactionSchema.shape.kind,
    amountMinor: TransactionSchema.shape.amountMinor,
    date: IsoDate,
    categoryId: Id.nullable(),
    note: TransactionSchema.shape.note,
    payee: TransactionSchema.shape.payee,
    tags: TransactionSchema.shape.tags,
    toAccountId: Id.nullable(),
    toAmountMinor: TransactionSchema.shape.toAmountMinor,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Send at least one field")
  .openapi("TransactionPatch");

export const TransactionQuerySchema = z.object({
  from: IsoDate.optional().openapi({ description: "First day; default 90 days before `to`" }),
  to: IsoDate.optional().openapi({ description: "Last day; default today" }),
  accountId: Id.optional(),
  categoryId: Id.optional(),
  kind: TransactionSchema.shape.kind.optional(),
  q: z
    .string()
    .trim()
    .max(60)
    .optional()
    .openapi({ description: "Text in the note, payee or tags" }),
});

// ---- Budgets --------------------------------------------------------------------------------------------------

export const BudgetSchema = z
  .object({
    id: Id,
    categoryId: Id,
    /** The monthly limit, in `currency` (the user's base currency when it was set). */
    limitMinor: z.number().int().positive(),
    currency: CurrencyCode,
    /** Shares of the limit that raise an alert in the app, e.g. 0.8 and 1. */
    alertAt: z.array(z.number().min(0.1).max(2)).max(3),
    /** What is left of a month is added to the next one. */
    rollover: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Budget");

export type Budget = z.infer<typeof BudgetSchema>;

export const BudgetCreateSchema = z
  .object({
    categoryId: Id,
    limitMinor: BudgetSchema.shape.limitMinor,
    currency: CurrencyCode.optional(),
    alertAt: BudgetSchema.shape.alertAt.default([0.8, 1]),
    rollover: z.boolean().default(false),
  })
  .strict()
  .openapi("BudgetCreate");

export const BudgetPatchSchema = z
  .object({
    limitMinor: BudgetSchema.shape.limitMinor,
    alertAt: BudgetSchema.shape.alertAt,
    rollover: z.boolean(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Send at least one field")
  .openapi("BudgetPatch");
