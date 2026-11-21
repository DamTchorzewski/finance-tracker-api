import type { CashTable, MidTable } from "./types.ts";
import { UpstreamError } from "./types.ts";

// National Bank of Poland, https://api.nbp.pl (no key). Table A: mid rates on working days around noon; table C:
// buy and sell rates in the morning. A day without a table answers 404; a range is at most 93 days.
// NBP also answers 500 now and then to a request that works a moment later (seen on 2026-11-21), so a 5xx or a
// timeout is tried once more before the caller falls back to the ECB rates.
const BASE = "https://api.nbp.pl/api/exchangerates/tables";
const RETRY_AFTER_MS = 400;

interface NbpA {
  effectiveDate: string;
  rates: { code: string; mid: number }[];
}
interface NbpC {
  effectiveDate: string;
  tradingDate: string;
  rates: { code: string; bid: number; ask: number }[];
}

async function attempt<T>(fetcher: typeof fetch, url: string): Promise<T[]> {
  let res: Response;
  try {
    res = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new UpstreamError(`NBP did not answer: ${(err as Error).message}`);
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new UpstreamError(`NBP answered ${res.status}`);
  return (await res.json()) as T[];
}

async function get<T>(fetcher: typeof fetch, url: string, retryAfterMs = RETRY_AFTER_MS) {
  try {
    return await attempt<T>(fetcher, url);
  } catch (err) {
    if (!(err instanceof UpstreamError)) throw err;
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    return attempt<T>(fetcher, url);
  }
}

/**
 * The table A days between two days. Without `from` and `to` the latest table: what "today" means, and the
 * request NBP answers most reliably.
 */
export async function nbpMidTables(
  fetcher: typeof fetch,
  from?: string,
  to?: string,
): Promise<MidTable[]> {
  const tables = await get<NbpA>(fetcher, from && to ? `${BASE}/A/${from}/${to}/` : `${BASE}/A/`);
  return tables.map((table) => ({
    source: "nbp-a",
    date: table.effectiveDate,
    rates: Object.fromEntries(table.rates.map((rate) => [rate.code, rate.mid])),
  }));
}

/** The table C days between two days; without them the latest table. */
export async function nbpCashTables(
  fetcher: typeof fetch,
  from?: string,
  to?: string,
): Promise<CashTable[]> {
  const tables = await get<NbpC>(fetcher, from && to ? `${BASE}/C/${from}/${to}/` : `${BASE}/C/`);
  return tables.map((table) => ({
    source: "nbp-c",
    date: table.effectiveDate,
    tradingDate: table.tradingDate,
    rates: Object.fromEntries(
      table.rates.map((rate) => [rate.code, { bid: rate.bid, ask: rate.ask }]),
    ),
  }));
}
