import { z } from "@hono/zod-openapi";

/** ISO 4217 code in upper case, e.g. PLN. */
export const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a three-letter ISO 4217 code, e.g. PLN")
  .openapi({ example: "PLN" });

/** A calendar day, YYYY-MM-DD, with no time zone (the day the money moved). */
export const IsoDate = z.iso.date().openapi({ example: "2026-11-21" });

/** A UTC timestamp written by the API. */
export const Timestamp = z.iso.datetime().openapi({ example: "2026-11-21T10:15:00.000Z" });

export const Id = z.string().min(1).max(64).openapi({ example: "k3Jd9sQ2" });

export const IdParam = z.object({
  id: Id.openapi({ param: { name: "id", in: "path" } }),
});
