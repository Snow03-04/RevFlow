/**
 * Recognising a product's COGS collection from its title.
 *
 * A supplier usually prices by product TYPE ("any tote", "any laundry basket"),
 * and a store adds new designs of the same type all the time. A new design is
 * not a member of any collection yet, so its orders fell back to a % of the
 * price until someone assigned it by hand.
 *
 * The collections already say which words mean which type: when (nearly) every
 * product of a store whose title has "pyykkikori" sits in "Cestos", a new
 * "… -pyykkikori" product belongs there too. Words are learned per store, so
 * each language gets its own, and only from the merchant's own assignments —
 * a word that also appears in another collection, or in many products left
 * outside, identifies nothing and is ignored.
 */

/** A word must be in at least this many members to identify a collection… */
const MIN_SUPPORT = 5;
/** …and in at least this share of that collection's members in the store, so a
 * design word shared by a handful of products ("kittens") can't decide. */
const MIN_SHARE = 0.1;
/** Products outside every collection that may share the word, relative to its
 * members. New designs are outside until assigned, so a batch of them must not
 * silence the word; but when most products with it are left out, the merchant
 * evidently keeps the collection to a subset and the word decides nothing. */
const MAX_OUTSIDE_SHARE = 0.5;

/** Lower-cased words of a title, letters and digits only, 3+ chars, no numbers. */
export function titleTokens(title: string | null | undefined): Set<string> {
  return new Set(
    (title ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w)),
  );
}

/** Items a variant stands for: "2 kpl – säästä 15 %" is two in one order line. */
export function packSize(variantTitle: string | null | undefined): number {
  const m = (variantTitle ?? "").match(
    /(?:^|[\s/(])(\d{1,2})\s*(?:ks|kpl|szt|pcs|stk|st|pz|db|buc)\b/i,
  );
  const n = m ? Number(m[1]) : 1;
  return n >= 1 ? n : 1;
}

/**
 * Learns the words that identify each collection among ONE store's products
 * and returns a lookup from a title to the collection it belongs to.
 */
export function buildCollectionMatcher(
  catalogue: { productId: string; title: string | null }[],
  collectionByProduct: Map<string, string>,
): (title: string | null | undefined) => string | undefined {
  const membersOf = new Map<string, number>();
  // word -> collection -> members with it ("" = products in no collection)
  const support = new Map<string, Map<string, number>>();
  const seen = new Set<string>();
  for (const p of catalogue) {
    if (seen.has(p.productId)) continue;
    seen.add(p.productId);
    const cid = collectionByProduct.get(p.productId) ?? "";
    if (cid) membersOf.set(cid, (membersOf.get(cid) ?? 0) + 1);
    for (const word of titleTokens(p.title)) {
      const byCol = support.get(word) ?? new Map<string, number>();
      byCol.set(cid, (byCol.get(cid) ?? 0) + 1);
      support.set(word, byCol);
    }
  }

  const markers = new Map<string, { cid: string; support: number }>();
  for (const [word, byCol] of support) {
    const cols = [...byCol.keys()].filter((c) => c !== "");
    if (cols.length !== 1) continue;
    const cid = cols[0];
    const n = byCol.get(cid)!;
    if (n < Math.max(MIN_SUPPORT, MIN_SHARE * (membersOf.get(cid) ?? 0))) continue;
    if ((byCol.get("") ?? 0) > MAX_OUTSIDE_SHARE * n) continue;
    markers.set(word, { cid, support: n });
  }

  return (title) => {
    if (markers.size === 0) return undefined;
    let best: { cid: string; support: number } | undefined;
    for (const word of titleTokens(title)) {
      const m = markers.get(word);
      if (m && (!best || m.support > best.support)) best = m;
    }
    return best?.cid;
  };
}
