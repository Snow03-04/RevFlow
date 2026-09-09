import "server-only";
import { graphPaginate } from "@/lib/meta/client";

/**
 * Resolve what each Meta campaign advertises by reading the destination URL of
 * its ads' creatives — the `/products/<handle>` slug for a product campaign, or
 * the `/collections/<handle>` slug when the ads send traffic to a COLLECTION
 * landing page. Far more reliable than guessing from the campaign name.
 *
 * Returns a map of campaign_id -> the dominant target across the campaign's ads.
 * Best-effort: ads/creatives whose link can't be parsed are simply skipped.
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

/** What an ad's destination URL points at. */
export type AdTargetKind = "product" | "collection";

export interface AdTarget {
  kind: AdTargetKind;
  handle: string;
}

/**
 * Classify a Shopify destination URL as a product or a collection page.
 *
 * `/products/<handle>` is checked FIRST on purpose: Shopify also serves product
 * pages under `/collections/<c>/products/<p>`, and a customer following that
 * link lands on the PRODUCT, not on the collection listing.
 */
export function targetFromUrl(url: string): AdTarget | null {
  try {
    const u = new URL(url);
    const product = u.pathname.match(/\/products\/([^/?#]+)/i);
    if (product)
      return { kind: "product", handle: decodeURIComponent(product[1]).toLowerCase() };
    const collection = u.pathname.match(/\/collections\/([^/?#]+)/i);
    if (collection)
      return {
        kind: "collection",
        handle: decodeURIComponent(collection[1]).toLowerCase(),
      };
    return null;
  } catch {
    return null;
  }
}

/** Extract the Shopify product handle from a `/products/<handle>` URL. */
export function handleFromUrl(url: string): string | null {
  const t = targetFromUrl(url);
  return t?.kind === "product" ? t.handle : null;
}

/** The dominant destination of one campaign's ads, per kind. */
export interface CampaignTarget {
  product: string | null;
  collection: string | null;
  /** Which of the two the campaign's ads mostly point at. */
  kind: AdTargetKind;
}

/**
 * Ad statuses worth reading a link from.
 *
 * The obvious filter — ACTIVE + PAUSED — is a trap. Meta rolls the parent
 * hierarchy up into an ad's `effective_status`, so pausing a CAMPAIGN flips
 * every one of its ads to CAMPAIGN_PAUSED and they vanish from that filter. The
 * campaign still carries spend on the days it ran, which is exactly what the
 * ROAS tracker has to evaluate — so it showed real spend against a campaign it
 * could no longer resolve to anything. On a live account that filter returned
 * 20 ads out of 376. DELETED is the only state deliberately left out.
 */
const READABLE_AD_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "ARCHIVED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "IN_PROCESS",
  "WITH_ISSUES",
];

/**
 * How much one ad's vote counts toward its campaign's landing page.
 *
 * Reading archived ads is what makes a paused campaign resolvable at all, but
 * counting them equally would let a dead creative outvote the live one: a
 * campaign switched from a product page to a collection page would keep
 * resolving to the product, because fifty archived ads still point there. Live
 * ads outweigh paused ones, which outweigh archived ones — history decides only
 * when nothing current does.
 */
/** Ads read per campaign before we stop — far more than any campaign needs. */
const MAX_PAGES_PER_CAMPAIGN = 5;
/** Page size. Meta refuses larger pages once `creative` is expanded. */
const AD_PAGE_SIZE = "50";
/** Campaigns fetched at once. */
const CONCURRENCY = 6;

function adWeight(effectiveStatus: string | undefined): number {
  switch (effectiveStatus) {
    case "ACTIVE":
      return 100;
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED":
      return 10;
    case "ARCHIVED":
      return 1;
    default:
      // PAUSED plus the review/billing states: a real ad someone still means to
      // run, just not running this second.
      return 50;
  }
}

/**
 * Read the landing page of each given campaign, from its ads' creatives.
 *
 * Asking per CAMPAIGN rather than sweeping the whole ad account is what keeps
 * this inside a sync's time budget. Expanding `creative` costs Meta about three
 * seconds a page and it refuses pages larger than ~50 once expanded, so reading
 * an account's every ad took ~25s for 376 ads — enough to blow the serverless
 * limit and fail the whole sync. The tracker only ever asks about campaigns
 * that actually spent, and fetching exactly those took 2.8s for 22 campaigns
 * with every one resolved. One campaign failing is skipped, not fatal.
 */
export async function fetchCampaignTargets(
  campaignIds: string[],
  token: string,
): Promise<Map<string, CampaignTarget>> {
  const fields =
    "effective_status," +
    "creative{link_url,object_story_spec{link_data{link},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}}}";

  // campaign_id -> `${kind}:${handle}` -> weight, so we can pick the dominant
  // handle of each kind AND which kind the campaign leans on overall.
  const counts = new Map<string, Map<string, number>>();

  const ids = [...new Set(campaignIds)];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const cid = ids[next++];
      const inner = new Map<string, number>();
      try {
        let pages = 0;
        for await (const page of graphPaginate<any>(`${cid}/ads`, {
          fields,
          limit: AD_PAGE_SIZE,
          effective_status: JSON.stringify(READABLE_AD_STATUSES),
          access_token: token,
        })) {
          for (const ad of page) {
            const weight = adWeight(ad.effective_status);
            for (const link of linksFromCreative(ad.creative)) {
              const t = targetFromUrl(link);
              if (!t) continue;
              const key = `${t.kind}:${t.handle}`;
              inner.set(key, (inner.get(key) ?? 0) + weight);
            }
          }
          if (++pages >= MAX_PAGES_PER_CAMPAIGN) break;
        }
      } catch {
        // This campaign stays unresolved; the rest of the batch is unaffected.
        continue;
      }
      if (inner.size > 0) counts.set(cid, inner);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker),
  );

  const result = new Map<string, CampaignTarget>();
  for (const [cid, inner] of counts) {
    let product: string | null = null;
    let productN = 0;
    let collection: string | null = null;
    let collectionN = 0;
    let productTotal = 0;
    let collectionTotal = 0;

    for (const [key, n] of inner) {
      const sep = key.indexOf(":");
      const kind = key.slice(0, sep) as AdTargetKind;
      const handle = key.slice(sep + 1);
      if (kind === "product") {
        productTotal += n;
        if (n > productN) {
          product = handle;
          productN = n;
        }
      } else {
        collectionTotal += n;
        if (n > collectionN) {
          collection = handle;
          collectionN = n;
        }
      }
    }
    if (!product && !collection) continue;
    // Ties go to the product — the more specific of the two.
    result.set(cid, {
      product,
      collection,
      kind: collectionTotal > productTotal ? "collection" : "product",
    });
  }
  return result;
}
