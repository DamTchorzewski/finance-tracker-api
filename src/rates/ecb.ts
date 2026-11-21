import type { MidTable } from "./types.ts";
import { UpstreamError } from "./types.ts";

// Euro reference rates of the European Central Bank through Frankfurter, https://api.frankfurter.dev (no key, open
// CORS): the fallback when NBP does not answer. Asked with PLN as the base, so each rate is inverted to PLN per unit.
const BASE = "https://api.frankfurter.dev/v1";

interface Range {
  rates: Record<string, Record<string, number>>;
}

export async function ecbMidTables(
  fetcher: typeof fetch,
  from: string,
  to: string,
): Promise<MidTable[]> {
  let res: Response;
  try {
    res = await fetcher(`${BASE}/${from}..${to}?base=PLN`, { signal: AbortSignal.timeout(6000) });
  } catch (err) {
    throw new UpstreamError(`ECB rates did not answer: ${(err as Error).message}`);
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new UpstreamError(`ECB rates answered ${res.status}`);
  const body = (await res.json()) as Range;

  return Object.entries(body.rates ?? {})
    .filter(([date]) => date >= from && date <= to)
    .map(([date, rates]) => ({
      source: "ecb" as const,
      date,
      rates: Object.fromEntries(
        Object.entries(rates).map(([code, perPln]) => [code, Math.round(1e6 / perPln) / 1e6]),
      ),
    }));
}
