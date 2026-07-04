import "server-only";

/**
 * Live currency conversion using the European Central Bank daily reference
 * rates (via the free, key-less Frankfurter API).
 *
 * The rate is fetched and cached for 12h. Crucially, the external call is
 * hard-capped with a timeout and falls back to the last good rate (then 1), so a
 * slow/unreachable Frankfurter can NEVER hang a page render for seconds.
 */

// Use the current domain + path directly. The old `api.frankfurter.app/latest`
// now issues a 301 to `api.frankfurter.dev/v1/latest`; making the server follow
// that redirect on every call is slow and flaky from some regions.
const FRANKFURTER = "https://api.frankfurter.dev/v1";
const FETCH_TIMEOUT_MS = 2500;

// Last successful rate per currency pair, kept for the lifetime of the (warm)
// serverless instance. Lets us reuse a known-good rate if a later fetch times
// out instead of silently falling back to 1 (which would misconvert amounts).
const lastGoodRate = new Map<string, number>();

/** How many units of `quote` equal 1 unit of `base` (e.g. base=CZK, quote=EUR). */
export async function getCurrentRate(
  base: string | null | undefined,
  quote: string | null | undefined,
): Promise<number> {
  if (!base || !quote) return 1;
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;
  const key = `${b}:${q}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${FRANKFURTER}/latest?from=${b}&to=${q}`, {
      redirect: "follow",
      // Cache for 12h — the ECB publishes at most once per business day.
      next: { revalidate: 43200 },
      signal: controller.signal,
    });
    if (!res.ok) return lastGoodRate.get(key) ?? 1;
    const json: any = await res.json();
    const rate = json?.rates?.[q];
    if (typeof rate === "number" && rate > 0) {
      lastGoodRate.set(key, rate);
      return rate;
    }
    return lastGoodRate.get(key) ?? 1;
  } catch {
    // Timeout / network / parse failure: reuse the last good rate, else 1.
    return lastGoodRate.get(key) ?? 1;
  } finally {
    clearTimeout(timer);
  }
}
