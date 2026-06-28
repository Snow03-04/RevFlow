import "server-only";

/**
 * Free text translation via Google's public translate endpoint — no API key,
 * no billing, and it auto-detects the source language (handy when products are
 * imported from different countries). Used server-side only.
 */

async function translateOne(text: string, targetLang: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return text;
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(clean)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const data = (await res.json()) as unknown;
  // Shape: [ [ [translatedSegment, originalSegment, ...], ... ], ... ]
  const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  const out = segments
    .map((s) => (Array.isArray(s) && typeof s[0] === "string" ? s[0] : ""))
    .join("");
  return out || text;
}

/**
 * Translate many strings to `targetLang`. De-duplicates first (variant names
 * like "Red" / "L" repeat a lot), translates each unique string once with
 * small concurrency, and falls back to the original on any failure.
 */
export async function translateMany(
  texts: string[],
  targetLang: string,
): Promise<Map<string, string>> {
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const out = new Map<string, string>();
  const CONCURRENCY = 5;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          return [t, await translateOne(t, targetLang)] as const;
        } catch {
          return [t, t] as const; // keep original if the call fails
        }
      }),
    );
    for (const [k, v] of results) out.set(k, v);
  }
  return out;
}
