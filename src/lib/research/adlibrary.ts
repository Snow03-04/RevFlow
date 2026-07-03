import "server-only";
import { graphPaginate } from "@/lib/meta/client";
import { serverEnv } from "@/lib/env";
import type { TablesInsert } from "@/types/database";

/**
 * Meta Ad Library helpers. The API can't search by a destination URL, so we
 * bridge from the product URL two ways: (1) the store's Facebook Page id
 * (accurate — all ads from that advertiser), and (2) keywords derived from the
 * URL/name (fallback). Commercial ads are only returned for EU markets (DSA).
 */

// Broad EU/EEA coverage — the API returns ads that reached ANY listed country.
const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "IS", "LI", "NO",
];

const AD_FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_descriptions",
  "ad_creative_link_captions",
  "ad_snapshot_url",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "publisher_platforms",
  "ad_reached_countries",
].join(",");

/** Extract the Ad Library archive id from a pasted link (or raw id). */
export function parseAdArchiveId(input: string): string | null {
  const s = input.trim();
  const q = s.match(/[?&]id=(\d{5,})/);
  if (q) return q[1];
  const digits = s.match(/(\d{8,})/);
  return digits ? digits[1] : null;
}

/** Turn a product URL/name into concise Ad Library search terms. */
export function deriveSearchTerms(
  url: string | null,
  name: string | null,
): string {
  const fromName = (name ?? "").trim();
  if (fromName && fromName.toLowerCase() !== "novo produto") return fromName.slice(0, 100);
  if (!url) return fromName;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const seg = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
    return seg
      .replace(/\.[a-z]+$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\d{4,}\b/g, "") // drop long ids
      .trim()
      .slice(0, 100);
  } catch {
    return fromName;
  }
}

/**
 * Best-effort: find the advertiser's Facebook Page id from the product site
 * (footer/social link or og tags), resolving a username via Graph when needed.
 * Returns null on any failure — the caller falls back to keyword search.
 */
export async function discoverPageId(
  url: string | null,
  token: string,
): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url.startsWith("http") ? url : `https://${url}`, {
      cache: "no-store",
      headers: { "user-agent": "Mozilla/5.0 RevFlowBot" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400_000);

    // Direct numeric page id in a facebook link.
    const numeric =
      html.match(/facebook\.com\/(?:profile\.php\?id=|pages\/[^/]+\/)(\d{6,})/i) ??
      html.match(/"page_id"\s*:\s*"?(\d{6,})"?/i);
    if (numeric) return numeric[1];

    // A page username → resolve to id via Graph (public pages).
    const handleMatch = html.match(
      /facebook\.com\/([A-Za-z0-9.\-]{3,50})(?:[/"'?]|$)/i,
    );
    const bad = new Set(["sharer", "tr", "plugins", "dialog", "profile.php", "pages"]);
    const handle = handleMatch?.[1];
    if (handle && !bad.has(handle.toLowerCase())) {
      const g = await fetch(
        `https://graph.facebook.com/${serverEnv.meta.apiVersion}/${encodeURIComponent(
          handle,
        )}?fields=id&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      if (g.ok) {
        const j = (await g.json()) as { id?: string };
        if (j.id && /^\d+$/.test(j.id)) return j.id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function mapAd(
  r: any,
  userId: string,
  productId: string,
): TablesInsert<"research_ads"> {
  const stop = r.ad_delivery_stop_time as string | undefined;
  const active = !stop || new Date(stop).getTime() > Date.now();
  return {
    user_id: userId,
    product_id: productId,
    ad_archive_id: String(r.id),
    page_id: r.page_id ?? null,
    page_name: r.page_name ?? null,
    body: r.ad_creative_bodies?.[0] ?? null,
    title: r.ad_creative_link_titles?.[0] ?? null,
    description: r.ad_creative_link_descriptions?.[0] ?? null,
    cta: null,
    link_url: r.ad_creative_link_captions?.[0] ?? null,
    snapshot_url: r.ad_snapshot_url ?? null,
    countries: r.ad_reached_countries ?? [],
    platforms: r.publisher_platforms ?? [],
    started_at: r.ad_delivery_start_time
      ? String(r.ad_delivery_start_time).slice(0, 10)
      : null,
    active,
    raw: r,
  };
}

/**
 * Search the Ad Library and return mapped ad rows (deduped by archive id),
 * capped at `max`. Prefers a page-id search; falls back to keyword terms.
 */
export async function searchAdsArchive(
  token: string,
  opts: {
    userId: string;
    productId: string;
    pageId?: string | null;
    searchTerms?: string | null;
    max?: number;
  },
): Promise<TablesInsert<"research_ads">[]> {
  const max = opts.max ?? 60;
  const base: Record<string, string> = {
    ad_type: "ALL",
    ad_active_status: "ALL",
    ad_reached_countries: JSON.stringify(EU_COUNTRIES),
    fields: AD_FIELDS,
    limit: "50",
    access_token: token,
  };
  if (opts.pageId) base.search_page_ids = JSON.stringify([opts.pageId]);
  else if (opts.searchTerms) base.search_terms = opts.searchTerms;
  else return [];

  const out: TablesInsert<"research_ads">[] = [];
  const seen = new Set<string>();
  for await (const page of graphPaginate<any>("ads_archive", base)) {
    for (const r of page) {
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(mapAd(r, opts.userId, opts.productId));
      if (out.length >= max) return out;
    }
  }
  return out;
}
