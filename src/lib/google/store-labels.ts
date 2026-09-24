import { storeLabel } from "@/lib/utils";

export type NamedStore = { id: string; shop_name: string | null; shop_domain: string };

/** Longest exact store name wins: "Ana" must never claim "Ana Maria". */
export function googleLabelStore(label: string | null, stores: NamedStore[]): string | null {
  const text = (label ?? "").trim().toLocaleLowerCase();
  if (!/^google\s/i.test(text)) return null;
  const rest = text.replace(/^google\s+/i, "");
  const matches = stores.flatMap((s) => {
    const aliases = [storeLabel(s.shop_name, s.shop_domain), s.shop_domain.split(".")[0]];
    return aliases.filter(Boolean).filter((name) => {
      const n = name.toLocaleLowerCase();
      return rest === n || rest.startsWith(`${n} `) || rest.startsWith(`${n} ·`);
    }).map((name) => ({ id: s.id, length: name.length }));
  }).sort((a, b) => b.length - a.length);
  if (!matches.length) return null;
  const best = matches.filter((m) => m.length === matches[0].length);
  return new Set(best.map((m) => m.id)).size === 1 ? best[0].id : null;
}

/** Legacy dashboard expenses also accept store tokens and an unnamed primary-store entry. */
export function googleSpendStore(label: string | null, stores: NamedStore[]): string | null {
  const text = (label ?? "").trim().toLowerCase();
  if (!text.startsWith("google")) return null;
  const exact = googleLabelStore(label, stores);
  if (exact) return exact;
  for (const store of stores) {
    const name = (store.shop_name ?? "").trim().toLowerCase();
    const slug = store.shop_domain.split(".")[0]?.toLowerCase() ?? "";
    const tokens = [name, ...name.split(/\s+/).filter((word) => word.length >= 3), slug, slug.replace(/-/g, "")].filter(Boolean);
    if (tokens.some((token) => text.includes(token))) return store.id;
  }
  return stores[0]?.id ?? null;
}

export function renamedGoogleLabel(label: string, store: NamedStore, newName: string): string {
  const rest = label.trim().replace(/^google\s+/i, "");
  const aliases = [storeLabel(store.shop_name, store.shop_domain), store.shop_domain.split(".")[0]].sort((a, b) => b.length - a.length);
  const old = aliases.find((name) => rest.toLocaleLowerCase() === name.toLocaleLowerCase() || rest.toLocaleLowerCase().startsWith(`${name.toLocaleLowerCase()} `));
  return old ? `Google ${newName}${rest.slice(old.length)}` : label;
}
