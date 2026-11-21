/** Mid rates of one day: PLN per 1 unit of each currency. */
export interface MidTable {
  source: "nbp-a" | "ecb";
  /** The day the table is valid for (NBP: effectiveDate; ECB: the reference day). */
  date: string;
  rates: Record<string, number>;
}

/** NBP table C: what banks buy (bid) and sell (ask) a currency for, in PLN. */
export interface CashTable {
  source: "nbp-c";
  date: string;
  tradingDate: string;
  rates: Record<string, { bid: number; ask: number }>;
}

export type RateSource = MidTable["source"] | CashTable["source"];

/** Where the API keeps tables it has fetched. Past days never change, so they are kept for good. */
export interface RateCache {
  getTable(source: "nbp-a" | "ecb", date: string): Promise<MidTable | null>;
  putTables(tables: MidTable[]): Promise<void>;
  /** Which table answered a request for a day (a weekend or a holiday points at the day before). */
  getResolved(source: "nbp-a" | "ecb", day: string): Promise<string | null>;
  putResolved(source: "nbp-a" | "ecb", day: string, tableDate: string): Promise<void>;
}

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}
