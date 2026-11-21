import { z } from "@hono/zod-openapi";
import { CurrencyCode, Id, IsoDate, Timestamp } from "./common.ts";
import { CATEGORY_COLOURS } from "./ledger.ts";

// Savings goals ("jars"): a target amount, optionally a day to reach it by. What is saved comes either from the
// contributions the user puts in and takes out, or, for a goal linked to an account, from that account's balance.

export const GoalSchema = z
  .object({
    id: Id,
    name: z.string().trim().min(1).max(40),
    targetMinor: z.number().int().positive(),
    currency: CurrencyCode,
    /** The day the goal should be reached by, or null for "some day". */
    targetDate: IsoDate.nullable(),
    /** A savings account whose balance is the progress; contributions are then not used. */
    accountId: Id.nullable(),
    icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
    colour: z.enum(CATEGORY_COLOURS),
    archived: z.boolean(),
    order: z.number().int().min(0).max(999),
    /** What is saved so far, in the goal's currency: the sum of the contributions or the linked account's balance. */
    savedMinor: z.number().int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Goal");

export type Goal = z.infer<typeof GoalSchema>;
export type StoredGoal = Omit<Goal, "savedMinor">;

export const GoalCreateSchema = z
  .object({
    name: GoalSchema.shape.name,
    targetMinor: GoalSchema.shape.targetMinor,
    currency: CurrencyCode.optional(),
    targetDate: IsoDate.nullable().default(null),
    accountId: Id.nullable().default(null),
    icon: GoalSchema.shape.icon.default("piggy-bank"),
    colour: GoalSchema.shape.colour.default("teal"),
  })
  .strict()
  .openapi("GoalCreate");

export const GoalPatchSchema = z
  .object({
    name: GoalSchema.shape.name,
    targetMinor: GoalSchema.shape.targetMinor,
    targetDate: IsoDate.nullable(),
    accountId: Id.nullable(),
    icon: GoalSchema.shape.icon,
    colour: GoalSchema.shape.colour,
    archived: z.boolean(),
    order: GoalSchema.shape.order,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Send at least one field")
  .openapi("GoalPatch");

export const ContributionSchema = z
  .object({
    id: Id,
    goalId: Id,
    /** Positive puts money in, negative takes it out; in the goal's currency. */
    amountMinor: z
      .number()
      .int()
      .refine((n) => n !== 0, "Use an amount other than zero"),
    date: IsoDate,
    note: z.string().max(100),
    createdAt: Timestamp,
  })
  .openapi("Contribution");

export type Contribution = z.infer<typeof ContributionSchema>;

export const ContributionCreateSchema = z
  .object({
    amountMinor: ContributionSchema.shape.amountMinor,
    date: IsoDate,
    note: ContributionSchema.shape.note.default(""),
  })
  .strict()
  .openapi("ContributionCreate");
