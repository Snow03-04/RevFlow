import "server-only";

/**
 * Live currency conversion using the European Central Bank daily reference
 * rates (via the free, key-less Frankfurter API).
 *
 * The rate is fetched automatically and cached for 12h, so values shown in the
 * display currency follow the market without anyone entering a rate by hand.
 */

const FRANKFURTER = "https://api.frankfurter.app";

/** How many units of `quote` equal 1 unit of `base` (e.g. base=CZK, quote=EUR). */
export async function getCurrentRate(
  base: string | null | undefined,
  quote: string | null | undefined,
): Promise<number> {
  if (!base || !quote) return 1;
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;

  try {
    const res = await fetch(`${FRANKFURTER}/latest?from=${b}&to=${q}`, {
      // Cache for 12h — the ECB publishes at most once per business day.
      next: { revalidate: 43200 },
    });
    if (!res.ok) return 1;
    const json: any = await res.json();
    const rate = json?.rates?.[q];
    return typeof rate === "number" && rate > 0 ? rate : 1;
  } catch {
    // Network/parse failure: fall back to 1 (show store-currency amounts).
    return 1;
  }
}
