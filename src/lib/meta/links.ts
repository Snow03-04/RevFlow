import "server-only";
import { graphPaginate } from "@/lib/meta/client";

/**
 * Resolve which Shopify product each Meta campaign advertises by reading the
 * destination URL of its ads' creatives and extracting the `/products/<handle>`
 * slug. This is far more reliable than guessing from the campaign name.
 *
 * Returns a map of campaign_id -> product handle (the most common handle across
 * the campaign's ads). Best-effort: ads/creatives whose link can't be parsed
 * are simply skipped.
 */

/** Pull every candidate destination URL out of a (wildly inconsistent) creative. */
function linksFromCreative(c: unknown): string[] {
  const out: string[] = [];
  if (!c || typeof c !== "object") return out;
  const cr = c as Record<string, any>;
  if (typeof cr.link_url === "string") out.push(cr.link_url);
  const s = cr.object_story_spec;
  if (s) {
    if (s.link_data?.link) out.push(s.link_data.link);
    if (s.video_data?.call_to_action?.value?.link)
      out.push(s.video_data.call_to_action.value.link);
    if (s.template_data?.link) out.push(s.template_data.link);
  }
  for (const l of cr.asset_feed_spec?.link_urls ?? []) {
    if (l?.website_url) out.push(l.website_url);
  }
  return out;
}

/** Extract the Shopify product handle from a `/products/<handle>` URL. */
export function handleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/products\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function fetchCampaignHandles(
  adAccountId: string,
  token: string,
): Promise<Map<string, string>> {
  const fields =
    "campaign_id," +
    "creative{link_url,object_story_spec{link_data{link},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}}}";

  // campaign_id -> handle -> count, so we can pick the dominant handle.
  const counts = new Map<string, Map<string, number>>();

  let pages = 0;
  for await (const page of graphPaginate<any>(`${adAccountId}/ads`, {
    fields,
    limit: "200",
    effective_status: '["ACTIVE","PAUSED"]',
    access_token: token,
  })) {
    for (const ad of page) {
      const cid = ad.campaign_id ? String(ad.campaign_id) : null;
      if (!cid) continue;
      for (const link of linksFromCreative(ad.creative)) {
        const h = handleFromUrl(link);
        if (!h) continue;
        const inner = counts.get(cid) ?? new Map<string, number>();
        inner.set(h, (inner.get(h) ?? 0) + 1);
        counts.set(cid, inner);
      }
    }
    // Guard against very large accounts.
    if (++pages >= 10) break;
  }

  const result = new Map<string, string>();
  for (const [cid, inner] of counts) {
    let best: string | null = null;
    let bestN = 0;
    for (const [h, n] of inner) {
      if (n > bestN) {
        best = h;
        bestN = n;
      }
    }
    if (best) result.set(cid, best);
  }
  return result;
}
