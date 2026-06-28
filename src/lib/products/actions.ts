"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { getCurrentRate } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import { charmPrice } from "@/lib/products/languages";
import { translateMany } from "@/lib/products/localize";

export interface LocalizeResult {
  ok: boolean;
  error?: string;
  count?: number;
}

/**
 * Translate the catalog into `lang` and convert each product's price from
 * `fromCurrency` to `toCurrency` (optionally charm-rounded to end in 9),
 * storing the result per product+language. Display-only inside RevFlow.
 */
export async function localizeProductsAction(input: {
  lang: string;
  fromCurrency: string;
  toCurrency: string;
  charm: boolean;
}): Promise<LocalizeResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };

  const lang = input.lang?.trim();
  if (!lang) return { ok: false, error: "Escolhe um idioma." };

  const supabase = await createClient();

  // Catalog grouped by product (one localization per product, not per variant).
  const variants = await selectAllByUser<{
    shopify_product_id: string;
    title: string | null;
    variant_title: string | null;
    price: number;
  }>(
    supabase,
    "products",
    "shopify_product_id, title, variant_title, price",
    user.id,
  );

  interface Group {
    productId: string;
    title: string;
    variantTitles: Set<string>;
    price: number; // representative price = lowest non-zero variant price
  }
  const byProduct = new Map<string, Group>();
  for (const v of variants) {
    const id = v.shopify_product_id;
    if (!id) continue;
    const price = Number(v.price) || 0;
    const g = byProduct.get(id);
    if (!g) {
      byProduct.set(id, {
        productId: id,
        title: v.title ?? "",
        variantTitles: new Set(v.variant_title ? [v.variant_title] : []),
        price,
      });
    } else {
      if (v.variant_title) g.variantTitles.add(v.variant_title);
      if (price > 0 && (g.price === 0 || price < g.price)) g.price = price;
    }
  }

  const groups = [...byProduct.values()];
  if (groups.length === 0) {
    return {
      ok: false,
      error: "Sem produtos para localizar. Sincroniza os produtos primeiro.",
    };
  }

  // Translate every unique string (titles + variant names) in one pass.
  const allStrings: string[] = [];
  for (const g of groups) {
    if (g.title) allStrings.push(g.title);
    for (const vt of g.variantTitles) allStrings.push(vt);
  }
  const translations = await translateMany(allStrings, lang);
  const tr = (s: string) => translations.get(s.trim()) ?? s;

  const rate = await getCurrentRate(input.fromCurrency, input.toCurrency);

  const rows = groups.map((g) => {
    const converted = g.price * rate;
    const finalPrice = input.charm ? charmPrice(converted) : round2(converted);
    return {
      user_id: user.id,
      shopify_product_id: g.productId,
      lang,
      title: g.title ? tr(g.title) : null,
      description: null,
      variants: [...g.variantTitles].map((vt) => ({
        original: vt,
        translated: tr(vt),
      })),
      source_currency: input.fromCurrency,
      target_currency: input.toCurrency,
      original_price: round2(g.price),
      converted_price: finalPrice,
    };
  });

  const { error } = await supabase
    .from("product_localizations")
    .upsert(rows, { onConflict: "user_id,shopify_product_id,lang" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/products");
  return { ok: true, count: rows.length };
}
