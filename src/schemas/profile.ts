import { z } from "@hono/zod-openapi";
import { CurrencyCode } from "./common.ts";

export const WIDGETS = [
  "balance",
  "cashflow",
  "spending",
  "budgets",
  "goals",
  "recent",
  "rates",
  "upcoming",
] as const;

export const ProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).nullable(),
    baseCurrency: CurrencyCode,
    locale: z.enum(["pl", "en"]),
    /** The day the budget month starts on (the pay day), 1-28. */
    monthStartDay: z.number().int().min(1).max(28),
    theme: z.enum(["system", "light", "dark"]),
    /** Hue of the accent colour, 0-359. */
    accentHue: z.number().int().min(0).max(359),
    privacyMode: z.boolean(),
    /** The dashboard widgets in the order the user put them; a missing one is hidden. */
    widgets: z.array(z.enum(WIDGETS)).max(WIDGETS.length),
  })
  .openapi("Profile");

export type Profile = z.infer<typeof ProfileSchema>;

export const DEFAULT_PROFILE: Profile = {
  displayName: null,
  baseCurrency: "PLN",
  locale: "pl",
  monthStartDay: 1,
  theme: "system",
  accentHue: 328, // the Piggo brand hue (finance-tracker docs/brand.md)
  privacyMode: false,
  widgets: ["balance", "cashflow", "spending", "budgets", "recent", "rates"],
};

export const ProfilePatchSchema = ProfileSchema.partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Send at least one field")
  .openapi("ProfilePatch");

export const MeSchema = z
  .object({
    user: z.object({
      uid: z.string(),
      email: z.string().nullable(),
      name: z.string().nullable(),
      emailVerified: z.boolean(),
    }),
    profile: ProfileSchema,
  })
  .openapi("Me");
