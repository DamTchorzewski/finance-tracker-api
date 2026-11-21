import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors.ts";
import { testApp } from "../test/helpers.ts";
import { MemoryRateCache } from "./cache.ts";
import { RatesService } from "./service.ts";

type Answer = { status: number; body?: unknown } | Error;

/** A fetch that answers from a list of [url fragment, answer] rules and records every call. */
function fakeFetch(rules: [string, Answer | (() => Answer)][]) {
  const calls: string[] = [];
  const fetcher = ((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push(url);
    const rule = rules.find(([part]) => url.includes(part));
    if (!rule) return Promise.reject(new Error(`unexpected ${url}`));
    const answer = typeof rule[1] === "function" ? rule[1]() : rule[1];
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(
      new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
      }),
    );
  }) as typeof fetch;
  return { fetcher, calls };
}

const nbpA = (date: string, eur = 4.25, usd = 3.98) => ({
  table: "A",
  effectiveDate: date,
  rates: [
    { currency: "euro", code: "EUR", mid: eur },
    { currency: "dolar", code: "USD", mid: usd },
  ],
});

// Saturday 2026-11-21 at 10:00 in Warsaw
const SATURDAY = () => new Date("2026-11-21T09:00:00Z");

const service = (rules: [string, Answer | (() => Answer)][], cache = new MemoryRateCache()) => {
  const { fetcher, calls } = fakeFetch(rules);
  return { rates: new RatesService({ fetcher, cache, now: SATURDAY }), calls, cache };
};

describe("mid rates", () => {
  it("answers a weekend day with the last working day's NBP table and remembers it", async () => {
    const { rates, calls, cache } = service([
      ["api.nbp.pl", { status: 200, body: [nbpA("2026-11-19"), nbpA("2026-11-20", 4.3)] }],
    ]);
    const table = await rates.midTable("2026-11-15");
    expect(table).toMatchObject({ source: "nbp-a", date: "2026-11-20", requested: "2026-11-15" });
    expect(calls[0]).toContain("/tables/A/2026-11-05/2026-11-15/");
    expect(await cache.getResolved("nbp-a", "2026-11-15")).toBe("2026-11-20");

    // the second time comes from the cache, not from NBP
    const again = new RatesService({
      fetcher: () => Promise.reject(new Error("offline")),
      cache,
      now: SATURDAY,
    });
    expect((await again.midTable("2026-11-15")).rates.EUR).toBe(4.3);
  });

  it("tries NBP once more after a passing 500 before falling back", async () => {
    let calls = 0;
    const { rates } = service([
      [
        "api.nbp.pl",
        () => (++calls === 1 ? { status: 500 } : { status: 200, body: [nbpA("2026-11-20")] }),
      ],
    ]);
    expect((await rates.midTable()).source).toBe("nbp-a");
    expect(calls).toBe(2);
  });

  it("falls back to the ECB rates when NBP fails, inverted to PLN per unit", async () => {
    const { rates } = service([
      ["api.nbp.pl", { status: 500 }],
      [
        "frankfurter",
        {
          status: 200,
          body: { base: "PLN", rates: { "2026-11-20": { EUR: 0.2353, USD: 0.2513 } } },
        },
      ],
    ]);
    const table = await rates.midTable();
    expect(table).toMatchObject({
      source: "ecb",
      fallback: true,
      date: "2026-11-20",
      requested: "2026-11-21",
    });
    expect(table.rates.EUR).toBeCloseTo(4.2499, 3);
  });

  it("answers 503 when both sources fail and nothing is cached", async () => {
    const { rates } = service([
      ["api.nbp.pl", new Error("timeout")],
      ["frankfurter", { status: 502 }],
    ]);
    await expect(rates.midTable()).rejects.toMatchObject({ code: "upstream_unavailable" });
  });

  it("keeps serving the last answer for today when the sources fail later", async () => {
    let nbpUp = true;
    const { rates } = service([
      ["api.nbp.pl", () => (nbpUp ? { status: 200, body: [nbpA("2026-11-20")] } : { status: 500 })],
      ["frankfurter", { status: 500 }],
    ]);
    await rates.midTable();
    nbpUp = false;
    expect((await rates.midTable()).date).toBe("2026-11-20");
  });

  it("serves the rates when the cache fails", async () => {
    const broken = new MemoryRateCache();
    const fail = () => Promise.reject(new Error("Could not load the default credentials"));
    broken.putTables = fail;
    broken.putResolved = fail;
    broken.getResolved = fail;
    const { rates } = service(
      [["api.nbp.pl", { status: 200, body: [nbpA("2026-11-13")] }]],
      broken,
    );
    expect((await rates.midTable("2026-11-15")).date).toBe("2026-11-13");
    expect((await rates.history("EUR", "2026-11-01", "2026-11-20")).points).toHaveLength(1);
  });

  it("does not keep today's resolution for good: NBP may still publish", async () => {
    const { rates, cache } = service([["api.nbp.pl", { status: 200, body: [nbpA("2026-11-20")] }]]);
    await rates.midTable();
    expect(await cache.getResolved("nbp-a", "2026-11-21")).toBeNull();
  });

  it("treats a future day as today", async () => {
    const { rates } = service([["api.nbp.pl", { status: 200, body: [nbpA("2026-11-20")] }]]);
    expect((await rates.midTable("2030-01-01")).requested).toBe("2026-11-21");
  });
});

describe("history and conversion", () => {
  it("splits a long history into 93-day NBP requests", async () => {
    const { rates, calls } = service([["api.nbp.pl", { status: 200, body: [nbpA("2026-06-01")] }]]);
    const history = await rates.history("EUR", "2026-01-01", "2026-11-21");
    expect(calls).toHaveLength(4);
    expect(history.points[0]).toEqual({ date: "2026-06-01", mid: 4.25 });
  });

  it("refuses more than 366 days and a reversed range", async () => {
    const { rates } = service([]);
    await expect(rates.history("EUR", "2024-01-01", "2026-01-01")).rejects.toBeInstanceOf(ApiError);
    await expect(rates.history("EUR", "2026-05-01", "2026-04-01")).rejects.toBeInstanceOf(ApiError);
  });

  it("converts between two foreign currencies through PLN", async () => {
    const { rates } = service([["api.nbp.pl", { status: 200, body: [nbpA("2026-11-20")] }]]);
    expect(await rates.convert(10_000, "EUR", "USD")).toMatchObject({
      resultMinor: 10_678,
      rate: 1.067839,
      date: "2026-11-20",
      source: "nbp-a",
    });
    await expect(rates.convert(100, "XYZ", "PLN")).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("rates routes", () => {
  it("are public, cacheable by the CDN and validated", async () => {
    const { rates } = service([["api.nbp.pl", { status: 200, body: [nbpA("2026-11-20")] }]]);
    const { request } = testApp({}, undefined, rates);

    const past = await request("/api/rates?date=2026-11-02", { token: null });
    expect(past.status).toBe(200);
    expect(past.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=604800");

    const today = await request("/api/rates", { token: null });
    expect(today.headers.get("cache-control")).toBe("public, max-age=900, s-maxage=900");

    const converted = await request("/api/rates/convert?amountMinor=10000&from=EUR&to=PLN", {
      token: null,
    });
    expect(((await converted.json()) as { resultMinor: number }).resultMinor).toBe(42_500);

    expect((await request("/api/rates?date=21.11.2026", { token: null })).status).toBe(400);
    expect(
      (await request("/api/rates/convert?amountMinor=1.5&from=EUR&to=PLN", { token: null })).status,
    ).toBe(400);
  });

  it("answer 503 with the error shape when no source answers", async () => {
    const { request } = testApp();
    const res = await request("/api/rates", { token: null });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "upstream_unavailable",
    );
  });
});
