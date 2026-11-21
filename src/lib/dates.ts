// Calendar days as ISO strings (YYYY-MM-DD); arithmetic in UTC so no time zone shifts a day.

const warsawDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today in Warsaw: the day NBP publishes for. */
export const todayInWarsaw = (now: Date = new Date()): string => warsawDay.format(now);

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Splits [from, to] into ranges of at most `size` days (NBP answers at most 93 days at a time). */
export function chunkRange(from: string, to: string, size: number): [string, string][] {
  const ranges: [string, string][] = [];
  for (let start = from; start <= to; start = addDays(start, size)) {
    const end = addDays(start, size - 1);
    ranges.push([start, end < to ? end : to]);
  }
  return ranges;
}
