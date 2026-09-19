import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";

/** Scoped independently from Meta IDs, including OAuth and script ingestion. */
export const googleCollectionLinkId = (key: string) => `google:${key}`;

export function collectionHandle(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const path = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
    const handle = path.includes("/") ? /(?:^|\/)collections\/([^/?#]+)/i.exec(path)?.[1] : path;
    if (!handle) return null;
    const decoded = decodeURIComponent(handle).toLowerCase();
    return /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,199}$/u.test(decoded) ? decoded : null;
  } catch { return null; }
}

/** Only a unanimous destination is automatic. Mixed/product URLs stay unassigned. */
export function collectionFromUrls(urls: string[]): string | null {
  if (!urls.length) return null;
  const handles = urls.map(collectionHandle);
  return handles.every((h) => h && h === handles[0]) ? handles[0] : null;
}

export async function saveGoogleCollectionLinks(db: SupabaseClient<Database>, opts: {
  userId: string; storeId: string; customerId: string;
  targets: { id: string; finalUrls: string[] }[];
}) {
  const prefix = googleCollectionLinkId(`${opts.storeId}:${opts.customerId.replace(/\D/g, "")}:`);
  const existing = await selectAllByUser<{ campaign_id: string; link_kind: string | null }>(db,
    "campaign_links", "campaign_id,link_kind", opts.userId, (q) => q.like("campaign_id", `${prefix}%`));
  const manual = new Set(existing.filter((r) => r.link_kind === "google-manual").map((r) => r.campaign_id));
  const rows: TablesInsert<"campaign_links">[] = opts.targets.filter((t) => !manual.has(`${prefix}${t.id}`)).map((t) => ({
    user_id: opts.userId, campaign_id: `${prefix}${t.id}`, product_handle: null,
    collection_handle: collectionFromUrls(t.finalUrls), link_kind: "google-auto",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("campaign_links").upsert(rows.slice(i, i + 500), { onConflict: "user_id,campaign_id" });
    if (error) throw error;
  }
  return rows.length;
}
