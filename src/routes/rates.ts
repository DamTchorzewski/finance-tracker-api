import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../lib/auth.ts";
import { errorResponses } from "../lib/errors.ts";
import type { RatesService } from "../rates/service.ts";
import { CurrencyCode, IsoDate } from "../schemas/common.ts";
import { validationHook } from "./hook.ts";

const Source = z.enum(["nbp-a", "ecb"]);

const MidTableSchema = z
  .object({
    source: Source.openapi({
      description: "nbp-a = NBP table A; ecb = the fallback when NBP fails",
    }),
    date: IsoDate.openapi({ description: "The day of the table that answered" }),
    requested: IsoDate.openapi({ description: "The day that was asked for" }),
    fallback: z.boolean(),
    rates: z.record(z.string(), z.number()).openapi({
      description: "PLN per 1 unit of each currency",
      example: { EUR: 4.2512, USD: 3.6713 },
    }),
  })
  .openapi("MidTable");

const CashTableSchema = z
  .object({
    source: z.literal("nbp-c"),
    date: IsoDate,
    tradingDate: IsoDate,
    rates: z.record(z.string(), z.object({ bid: z.number(), ask: z.number() })),
  })
  .openapi("CashTable");

const HistorySchema = z
  .object({
    code: CurrencyCode,
    source: Source,
    points: z.array(z.object({ date: IsoDate, mid: z.number() })),
  })
  .openapi("RateHistory");

const ConversionSchema = z
  .object({
    amountMinor: z.number().int(),
    from: CurrencyCode,
    to: CurrencyCode,
    resultMinor: z.number().int(),
    rate: z.number().openapi({ description: "Units of `to` for one unit of `from`" }),
    date: IsoDate,
    source: Source,
    fallback: z.boolean(),
  })
  .openapi("Conversion");

const tags = ["Rates"];
const upstream = errorResponses(
  "bad_request",
  "validation",
  "rate_limited",
  "upstream_unavailable",
);
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const midRoute = createRoute({
  method: "get",
  path: "/rates",
  tags,
  summary:
    "Mid rates of a day (NBP table A; ECB when NBP fails). A day without a table gets the last one before it",
  request: { query: z.object({ date: IsoDate.optional() }) },
  responses: { 200: json(MidTableSchema, "The table"), ...upstream },
});

const cashRoute = createRoute({
  method: "get",
  path: "/rates/cash",
  tags,
  summary: "Bank buy and sell rates (NBP table C), the latest",
  responses: { 200: json(CashTableSchema, "The table"), ...upstream },
});

const historyRoute = createRoute({
  method: "get",
  path: "/rates/history",
  tags,
  summary: "The mid rate of one currency on every day with a table, at most 366 days",
  request: { query: z.object({ code: CurrencyCode, from: IsoDate, to: IsoDate }) },
  responses: { 200: json(HistorySchema, "The rates"), ...upstream },
});

const convertRoute = createRoute({
  method: "get",
  path: "/rates/convert",
  tags,
  summary: "Convert an amount in minor units at the mid rates of a day",
  request: {
    query: z.object({
      amountMinor: z.coerce.number().int().min(-1e15).max(1e15),
      from: CurrencyCode,
      to: CurrencyCode,
      date: IsoDate.optional(),
    }),
  },
  responses: { 200: json(ConversionSchema, "The result"), ...upstream },
});

/**
 * Public: the rates are public data and the demo needs them without an account. Firebase Hosting's CDN keeps the
 * answers (`s-maxage`), so most requests never reach Cloud Run; past days are kept for a week, today for 15 minutes.
 */
const cacheFor = (c: Context, day: string, today: string) =>
  c.header(
    "Cache-Control",
    day < today ? "public, max-age=86400, s-maxage=604800" : "public, max-age=900, s-maxage=900",
  );

export const ratesRoutes = (rates: RatesService) =>
  new OpenAPIHono<AppEnv>({ defaultHook: validationHook })
    .openapi(midRoute, async (c) => {
      const table = await rates.midTable(c.req.valid("query").date);
      cacheFor(c, table.requested, rates.today());
      return c.json(table, 200);
    })
    .openapi(cashRoute, async (c) => {
      const table = await rates.cashTable();
      cacheFor(c, rates.today(), rates.today());
      return c.json(table, 200);
    })
    .openapi(historyRoute, async (c) => {
      const { code, from, to } = c.req.valid("query");
      const history = await rates.history(code, from, to);
      cacheFor(c, to, rates.today());
      return c.json({ code, ...history }, 200);
    })
    .openapi(convertRoute, async (c) => {
      const { amountMinor, from, to, date } = c.req.valid("query");
      const result = await rates.convert(amountMinor, from, to, date);
      cacheFor(c, date ?? rates.today(), rates.today());
      return c.json(result, 200);
    });
