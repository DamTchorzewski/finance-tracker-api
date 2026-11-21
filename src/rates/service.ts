import { addDays, chunkRange, daysBetween, todayInWarsaw } from "../lib/dates.ts";
import { ApiError } from "../lib/errors.ts";
import { convertMinor } from "../lib/money.ts";
import { ecbMidTables } from "./ecb.ts";
import { nbpCashTables, nbpMidTables } from "./nbp.ts";
import type { CashTable, MidTable, RateCache } from "./types.ts";
import { UpstreamError } from "./types.ts";

/** How far back a day without a table looks for the last one (Easter and Christmas leave four free days). */
const LOOK_BACK = 10;
/** The answer for today may change when NBP publishes (about noon), so it is kept in memory for a short time only. */
const TODAY_TTL = 30 * 60_000;
export const MAX_HISTORY_DAYS = 366;

export interface RatesDeps {
  fetcher: typeof fetch;
  cache: RateCache;
  now?: () => Date;
}

export interface ResolvedTable extends MidTable {
  /** The day that was asked for; `date` is the table that answered it. */
  requested: string;
  /** True when NBP did not answer and the ECB rates were used. */
  fallback: boolean;
}

export interface History {
  source: MidTable["source"];
  points: { date: string; mid: number }[];
}

const MID_SOURCES = ["nbp-a", "ecb"] as const;

export class RatesService {
  private readonly fetcher: typeof fetch;
  private readonly cache: RateCache;
  private readonly now: () => Date;
  private readonly recent = new Map<string, { at: number; value: unknown }>();

  constructor({ fetcher, cache, now = () => new Date() }: RatesDeps) {
    this.fetcher = fetcher;
    this.cache = cache;
    this.now = now;
  }

  today() {
    return todayInWarsaw(this.now());
  }

  private remember<T>(key: string, value: T): T {
    this.recent.set(key, { at: this.now().getTime(), value });
    return value;
  }

  private fresh<T>(key: string): T | undefined {
    const hit = this.recent.get(key);
    return hit && this.now().getTime() - hit.at < TODAY_TTL ? (hit.value as T) : undefined;
  }

  private stale<T>(key: string): T | undefined {
    return this.recent.get(key)?.value as T | undefined;
  }

  private midTables(source: MidTable["source"], from: string, to: string) {
    return source === "nbp-a"
      ? nbpMidTables(this.fetcher, from, to)
      : ecbMidTables(this.fetcher, from, to);
  }

  /** The mid rates valid on a day: NBP table A, or the ECB rates when NBP fails. */
  async midTable(day?: string): Promise<ResolvedTable> {
    const today = this.today();
    const requested = !day || day > today ? today : day;
    const key = `mid:${requested}`;
    const past = requested < today;

    const cached =
      this.fresh<ResolvedTable>(key) ?? (past ? await this.fromCache(requested) : undefined);
    if (cached) return cached;

    for (const source of MID_SOURCES) {
      try {
        const tables =
          source === "nbp-a" && !past
            ? await nbpMidTables(this.fetcher)
            : await this.midTables(source, addDays(requested, -LOOK_BACK), requested);
        const table = tables.sort((a, b) => a.date.localeCompare(b.date)).at(-1);
        if (!table) continue;
        await this.cache.putTables(tables.filter((t) => t.date < today));
        if (past) await this.cache.putResolved(source, requested, table.date);
        return this.remember(key, { ...table, requested, fallback: source === "ecb" });
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
        console.warn(`rates: ${err.message}`);
      }
    }

    const last = this.stale<ResolvedTable>(key);
    if (last) return last;
    throw new ApiError("upstream_unavailable", "The exchange rates are not available right now");
  }

  private async fromCache(day: string): Promise<ResolvedTable | undefined> {
    for (const source of MID_SOURCES) {
      const date = await this.cache.getResolved(source, day);
      const table = date ? await this.cache.getTable(source, date) : null;
      if (table) return { ...table, requested: day, fallback: source === "ecb" };
    }
    return undefined;
  }

  /** The latest NBP table C (bank buy and sell rates). No fallback: the ECB has no such table. */
  async cashTable(): Promise<CashTable> {
    const key = "cash";
    const cached = this.fresh<CashTable>(key);
    if (cached) return cached;
    try {
      const tables = await nbpCashTables(this.fetcher);
      const table = tables.sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      if (table) return this.remember(key, table);
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      console.warn(`rates: ${err.message}`);
    }
    const last = this.stale<CashTable>(key);
    if (last) return last;
    throw new ApiError("upstream_unavailable", "The bank rates are not available right now");
  }

  /** The mid rate of one currency on every day with a table between two days. */
  async history(code: string, from: string, to: string): Promise<History> {
    const today = this.today();
    const end = to > today ? today : to;
    if (from > end) throw new ApiError("bad_request", "`from` must not be after `to`");
    if (daysBetween(from, end) > MAX_HISTORY_DAYS) {
      throw new ApiError("bad_request", `Ask for at most ${MAX_HISTORY_DAYS} days`);
    }
    const key = `history:${code}:${from}:${end}`;
    const cached = this.fresh<History>(key);
    if (cached) return cached;

    for (const source of MID_SOURCES) {
      try {
        const size = source === "nbp-a" ? 93 : MAX_HISTORY_DAYS + 1;
        const chunks = await Promise.all(
          chunkRange(from, end, size).map(([a, b]) => this.midTables(source, a, b)),
        );
        const tables = chunks.flat().sort((a, b) => a.date.localeCompare(b.date));
        await this.cache.putTables(tables.filter((table) => table.date < today));
        const points = tables.flatMap((table) => {
          const mid = code === "PLN" ? 1 : table.rates[code];
          return mid === undefined ? [] : [{ date: table.date, mid }];
        });
        if (!points.length) {
          if (tables.length) throw new ApiError("bad_request", `No rates for ${code}`);
          continue;
        }
        return this.remember(key, { source, points });
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
        console.warn(`rates: ${err.message}`);
      }
    }
    throw new ApiError("upstream_unavailable", "The exchange rates are not available right now");
  }

  /** Converts an amount between two currencies at the mid rates of a day (through PLN). */
  async convert(amountMinor: number, from: string, to: string, day?: string) {
    const table = await this.midTable(day);
    const mid = (code: string) => {
      if (code === "PLN") return 1;
      const rate = table.rates[code];
      if (rate === undefined) throw new ApiError("bad_request", `No rate for ${code}`);
      return rate;
    };
    const fromMid = mid(from);
    const toMid = mid(to);
    return {
      amountMinor,
      from,
      to,
      resultMinor: convertMinor(
        amountMinor,
        { code: from, mid: fromMid },
        { code: to, mid: toMid },
      ),
      /** Units of `to` for one unit of `from`. */
      rate: Math.round((fromMid / toMid) * 1e6) / 1e6,
      date: table.date,
      source: table.source,
      fallback: table.fallback,
    };
  }
}
