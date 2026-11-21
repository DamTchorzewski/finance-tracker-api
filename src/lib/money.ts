// Money is an integer number of minor units (grosze, cents) with an ISO 4217 code; never a float.

const digitsCache = new Map<string, number>();

/** How many minor-unit digits a currency has: PLN 2, JPY 0, from the ICU data of Node. */
export function minorDigits(code: string): number {
  let digits = digitsCache.get(code);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    digitsCache.set(code, digits);
  }
  return digits;
}

const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?$/;

/**
 * "86.40" or 86.4 in PLN → 8640. Rounds half away from zero on the decimal digits themselves, so 1.005 PLN is
 * 101 grosze (multiplying the float would give 100). A comma is read as the decimal separator.
 */
export function toMinor(amount: string | number, code: string): number {
  const digits = minorDigits(code);
  const text =
    typeof amount === "number"
      ? Number.isFinite(amount)
        ? amount.toPrecision(15)
        : ""
      : amount.trim().replace(",", ".");
  const match = DECIMAL.exec(text);

  if (!match || (!match[2] && !match[3])) {
    // a number toPrecision wrote with an exponent (very large or very small)
    if (typeof amount === "number" && Number.isFinite(amount)) {
      return Math.sign(amount) * Math.round(Math.abs(amount) * 10 ** digits) || 0;
    }
    throw new RangeError(`Not an amount: ${amount}`);
  }

  const [, sign, whole = "", fraction = ""] = match;
  const padded = fraction.padEnd(digits + 1, "0");
  let minor = Number(whole || "0") * 10 ** digits + Number(padded.slice(0, digits) || "0");
  if (Number(padded[digits]) >= 5) minor += 1;
  return sign === "-" && minor !== 0 ? -minor : minor;
}

/** 8640 in PLN → 86.4 */
export const fromMinor = (minor: number, code: string): number => minor / 10 ** minorDigits(code);

/**
 * Converts minor units of one currency to another with the mid rates in PLN (PLN per 1 unit; PLN itself is 1).
 * 100 EUR at 4.25 into USD at 3.98 → 106.78 USD.
 */
export function convertMinor(
  amountMinor: number,
  from: { code: string; mid: number },
  to: { code: string; mid: number },
): number {
  if (from.code === to.code) return amountMinor;
  const value = fromMinor(amountMinor, from.code) * (from.mid / to.mid);
  return toMinor(value, to.code);
}
