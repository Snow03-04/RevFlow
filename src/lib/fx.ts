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

/**
 * Fetch a fresh rate from Frankfurter, or `null` on any failure (timeout /
 * network / bad payload). Successful rates are cached per warm instance.
 */
async function fetchRate(b: string, q: string): Promise<number | null> {
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
    if (!res.ok) return null;
    const json: any = await res.json();
    const rate = json?.rates?.[q];
    if (typeof rate === "number" && rate > 0) {
      lastGoodRate.set(key, rate);
      return rate;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How many units of `quote` equal 1 unit of `base` (e.g. base=CZK, quote=EUR).
 *
 * Best-effort: falls back to the last good rate, then 1. Use for DISPLAY, where a
 * momentary miss just shows amounts unconverted — never for persistence.
 */
export async function getCurrentRate(
  base: string | null | undefined,
  quote: string | null | undefined,
): Promise<number> {
  if (!base || !quote) return 1;
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;
  const rate = await fetchRate(b, q);
  return rate ?? lastGoodRate.get(`${b}:${q}`) ?? 1;
}

/**
 * Like {@link getCurrentRate} but THROWS if a real rate can't be resolved for a
 * differing currency pair (instead of silently returning 1). Use whenever the
 * converted amount is PERSISTED — storing spend/revenue at rate 1 when the
 * currencies actually differ permanently corrupts the data. Aborting lets the
 * sync retry later with a real rate rather than writing garbage.
 */
export async function getRequiredRate(
  base: string | null | undefined,
  quote: string | null | undefined,
): Promise<number> {
  if (!base || !quote) {
    throw new Error(`FX: missing currency (${base} → ${quote}).`);
  }
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;
  const rate = (await fetchRate(b, q)) ?? lastGoodRate.get(`${b}:${q}`);
  if (rate == null) {
    throw new Error(
      `FX rate unavailable for ${b} → ${q}; refusing to store misconverted amounts.`,
    );
  }
  return rate;
}

export interface FxContext {
  storeCurrency?: string | null;
  displayCurrency?: string | null;
  /** Manual override: STORE units per 1 DISPLAY unit (e.g. 354 = 1 EUR = 354 HUF). */
  override?: number | null;
  /** When true, throw instead of silently falling back (for PERSISTED amounts). */
  required?: boolean;
}

/**
 * Resolve `from → to` (how many `to` per 1 `from`), honouring the merchant's
 * pinned store↔display rate when the pair is exactly that pair (either
 * direction). Any other pair falls back to the live rate. This keeps a single
 * user-chosen rate consistent across the whole app — revenue, ad spend, profit —
 * so the numbers match the merchant's own books.
 */
export async function resolveFx(
  from: string | null | undefined,
  to: string | null | undefined,
  ctx: FxContext = {},
): Promise<number> {
  const b = from?.toUpperCase();
  const q = to?.toUpperCase();
  if (!b || !q) {
    if (ctx.required) throw new Error(`FX: missing currency (${from} → ${to}).`);
    return 1;
  }
  if (b === q) return 1;

  const ov = ctx.override && ctx.override > 0 ? ctx.override : null;
  const store = ctx.storeCurrency?.toUpperCase();
  const disp = ctx.displayCurrency?.toUpperCase();
  if (ov && store && disp && store !== disp) {
    if (b === disp && q === store) return ov; // display → store (e.g. EUR → HUF)
    if (b === store && q === disp) return 1 / ov; // store → display (e.g. HUF → EUR)
  }
  return ctx.required ? getRequiredRate(from, to) : getCurrentRate(from, to);
}
