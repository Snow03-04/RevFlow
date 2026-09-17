"use server";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  fetchSupplierCosts,
  parseSheetRef,
  listSheetTabs,
  type SheetTab,
} from "@/lib/supplier/sheet";
import { selectAllByUser, selectAllIn } from "@/lib/supabase/paginate";
import { buildSupplierPlan } from "@/lib/supplier/plan";
import { refreshCostDependents } from "@/lib/cogs/refresh";
import type { Tables } from "@/types/database";

export interface SupplierActionResult {
  ok: boolean;
  error?: string;
  productsUpdated?: number;
  matchedOrders?: number;
  priceTiers?: { from: string; cost: number }[];
  paidTotal?: number;
  unpaidTotal?: number;
  unknownOrders?: number;
}

export async function saveSupplierSheetUrl(
  url: string,
): Promise<SupplierActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const db = await createClient();
  const trimmed = url.trim();
  if (trimmed && !parseSheetRef(trimmed))
    return { ok: false, error: "Isso não parece um link de Google Sheets." };
  if (trimmed) {
    const costs = await fetchSupplierCosts(trimmed);
    if (!costs)
      return {
        ok: false,
        error: "Não consegui ler a sheet. Confirma a partilha e o separador.",
      };
    if (costs.errors.length)
      return { ok: false, error: costs.errors.join(" ") };
  }
  const { error } = await db
    .from("settings")
    .update({ supplier_sheet_url: trimmed || null })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/supplier");
  revalidatePath("/costs");
  return { ok: true };
}

export type { SheetTab };

/** The spreadsheet's tabs, so the link's #gid can be picked instead of typed. */
export async function getSheetTabs(url: string): Promise<SheetTab[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return listSheetTabs(url);
}

/** Apply to an explicitly selected store; never guess from overlapping numbers.
 * Upsert replacements before deleting obsolete AUTO rows. Manual costs are
 * preserved, including an entry with the same product and effective date. */
export async function applySupplierCosts(
  storeId?: string,
): Promise<SupplierActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const db = await createClient();
  try {
    const { data: settings, error } = await db
      .from("settings")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (error) throw error;
    if (!settings.supplier_sheet_url) throw new Error("Falta o link da sheet.");
    const [costs, stores, orders, existingProductCosts, existingExact] =
      await Promise.all([
        fetchSupplierCosts(settings.supplier_sheet_url),
        selectAllByUser<Tables<"shopify_connections">>(
          db,
          "shopify_connections",
          "id,shop_name,shop_domain",
          user.id,
        ),
        selectAllByUser<Tables<"orders">>(
          db,
          "orders",
          "id,order_number,processed_at,shopify_connection_id",
          user.id,
        ),
        selectAllByUser<Tables<"product_costs">>(
          db,
          "product_costs",
          "*",
          user.id,
        ),
        selectAllByUser<Tables<"order_supplier_costs">>(
          db,
          "order_supplier_costs",
          "*",
          user.id,
        ),
      ]);
    if (!costs)
      throw new Error(
        "Não consegui ler a sheet. Os custos anteriores foram mantidos.",
      );
    const selected =
      stores.find((s) => s.id === storeId) ??
      (!storeId && stores.length === 1 ? stores[0] : undefined);
    if (!selected)
      throw new Error(
        "Seleciona a loja a que pertence este separador da sheet.",
      );
    const storeOrders = orders.filter(
      (o) => o.shopify_connection_id === selected.id,
    );
    const items = await selectAllIn<Tables<"order_line_items">>(
      db,
      "order_line_items",
      "order_id,shopify_product_id,quantity",
      user.id,
      "order_id",
      storeOrders.map((o) => o.id),
    );
    const plan = buildSupplierPlan(
      costs,
      storeOrders,
      items,
      selected.id,
      settings.timezone,
    );
    const currency = costs.currency ?? settings.currency;
    const key = (p: { shopify_product_id: string; effective_from: string }) =>
      p.shopify_product_id + ":" + p.effective_from;
    const manualKeys = new Set(
      existingProductCosts.filter((p) => p.source !== "sheet").map(key),
    );
    const rows = plan.productCosts
      .filter((p) => !manualKeys.has(key(p)))
      .map((p) => ({ ...p, user_id: user.id, currency, source: "sheet" }));
    const exact = plan.exact.map((r) => ({
      user_id: user.id,
      shopify_connection_id: selected.id,
      order_number: r.order,
      cost: r.cost,
      currency,
      paid: r.paid,
    }));
    for (let i = 0; i < exact.length; i += 500) {
      const { error } = await db
        .from("order_supplier_costs")
        .upsert(exact.slice(i, i + 500), {
          onConflict: "user_id,shopify_connection_id,order_number",
        });
      if (error) throw error;
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db
        .from("product_costs")
        .upsert(rows.slice(i, i + 500), {
          onConflict: "user_id,shopify_product_id,effective_from",
        });
      if (error) throw error;
    }
    const wanted = new Set(exact.map((r) => r.order_number));
    const removed = existingExact.filter(
      (r) =>
        r.shopify_connection_id === selected.id && !wanted.has(r.order_number),
    );
    for (let i = 0; i < removed.length; i += 200) {
      const { error } = await db
        .from("order_supplier_costs")
        .delete()
        .eq("user_id", user.id)
        .eq("shopify_connection_id", selected.id)
        .in(
          "order_number",
          removed.slice(i, i + 200).map((r) => r.order_number),
        );
      if (error) throw error;
    }
    const productIds = new Set(
      items.flatMap((li) =>
        li.shopify_product_id ? [li.shopify_product_id] : [],
      ),
    );
    const wantedKeys = new Set(rows.map(key));
    const obsolete = existingProductCosts.filter(
      (p) =>
        p.source === "sheet" &&
        productIds.has(p.shopify_product_id) &&
        !wantedKeys.has(key(p)),
    );
    for (const p of obsolete) {
      const { error } = await db
        .from("product_costs")
        .delete()
        .eq("user_id", user.id)
        .eq("shopify_product_id", p.shopify_product_id)
        .eq("effective_from", p.effective_from)
        .eq("source", "sheet");
      if (error) throw error;
    }
    await refreshCostDependents(db, user.id);
    for (const path of [
      "/supplier",
      "/costs",
      "/cogs-audit",
      "/dashboard",
      "/products",
      "/pnl",
      "/roas",
    ])
      revalidatePath(path);
    return {
      ok: true,
      productsUpdated: new Set(rows.map((p) => p.shopify_product_id)).size,
      matchedOrders: exact.length,
      paidTotal: costs.paidTotal,
      unpaidTotal: costs.unpaidTotal,
      unknownOrders: plan.unknownOrders.length,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : ((error as { message?: string })?.message ??
            "Falha ao aplicar os custos. Volta a tentar para concluir a atualização."),
    };
  }
}

export interface SupplierOrderRow {
  order: string;
  cost: number;
  paid: boolean;
}

export interface SupplierDiffRow {
  order: string;
  sheetCost: number | null; // what the sheet says now
  appliedCost: number | null; // what RevFlow is currently costing it at
  sheetPaid?: boolean;
  appliedPaid?: boolean;
}

export interface SupplierDiff {
  currency: string;
  error?: string;
  /** In the sheet, never applied — usually rows added since the last apply. */
  pending: SupplierDiffRow[];
  /** Applied, but the sheet now shows a different cost. */
  changed: SupplierDiffRow[];
  /** Applied, but the row is gone from the sheet. */
  removed: SupplierDiffRow[];
  /** In the sheet with a cost, but no such order exists in the store. */
  unknownOrders: string[];
  /** Paid/unpaid flag differs between sheet and what was applied. */
  paidChanged: SupplierDiffRow[];
  inSync: boolean;
  appliedCount: number;
  sheetCount: number;
}

export async function getSupplierDiff(
  storeId?: string,
): Promise<SupplierDiff | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = await createClient();
  const empty: SupplierDiff = {
    currency: "EUR",
    pending: [],
    changed: [],
    removed: [],
    unknownOrders: [],
    paidChanged: [],
    inSync: false,
    appliedCount: 0,
    sheetCount: 0,
  };
  try {
    const { data: settings, error } = await db
      .from("settings")
      .select("supplier_sheet_url,currency")
      .eq("user_id", user.id)
      .single();
    if (error) throw error;
    if (!settings?.supplier_sheet_url)
      return { ...empty, error: "Falta o link da sheet." };
    if (!storeId)
      return { ...empty, error: "Seleciona a loja para comparar os custos." };
    const [costs, appliedRows, orders] = await Promise.all([
      fetchSupplierCosts(settings.supplier_sheet_url),
      selectAllByUser<Tables<"order_supplier_costs">>(
        db,
        "order_supplier_costs",
        "*",
        user.id,
        (q) => q.eq("shopify_connection_id", storeId),
      ),
      selectAllByUser<Tables<"orders">>(
        db,
        "orders",
        "order_number",
        user.id,
        (q) => q.eq("shopify_connection_id", storeId),
      ),
    ]);
    if (!costs)
      return {
        ...empty,
        error: "Não foi possível ler a sheet. A comparação não foi concluída.",
      };
    if (costs.errors.length) return { ...empty, error: costs.errors.join(" ") };
    const applied = new Map(appliedRows.map((r) => [r.order_number, r]));
    const known = new Set(
      orders.map((o) => (o.order_number ?? "").replace(/\D/g, "")),
    );
    const out = {
      ...empty,
      currency: costs.currency ?? settings.currency,
      appliedCount: applied.size,
      sheetCount: costs.byOrder.size,
    };
    for (const [number, row] of costs.byOrder) {
      const old = applied.get(number);
      if (!known.has(number)) {
        out.unknownOrders.push(number);
        continue;
      }
      if (!old)
        out.pending.push({
          order: number,
          sheetCost: row.cost,
          appliedCost: null,
        });
      else {
        if (
          Math.abs(Number(old.cost) - row.cost) > 0.005 ||
          old.currency !== out.currency
        )
          out.changed.push({
            order: number,
            sheetCost: row.cost,
            appliedCost: Number(old.cost),
          });
        if (old.paid !== row.paid)
          out.paidChanged.push({
            order: number,
            sheetCost: row.cost,
            appliedCost: Number(old.cost),
            sheetPaid: row.paid,
            appliedPaid: old.paid,
          });
      }
    }
    for (const [number, row] of applied)
      if (!costs.byOrder.has(number))
        out.removed.push({
          order: number,
          sheetCost: null,
          appliedCost: Number(row.cost),
        });
    out.inSync =
      costs.byOrder.size > 0 &&
      [
        out.pending,
        out.changed,
        out.removed,
        out.paidChanged,
        out.unknownOrders,
      ].every((r) => r.length === 0);
    return out;
  } catch (error) {
    return {
      ...empty,
      error:
        error instanceof Error
          ? error.message
          : ((error as { message?: string })?.message ??
            "Falha na comparação."),
    };
  }
}

export interface SupplierData {
  url: string | null;
  currency: string;
  error?: string;
  paidTotal: number;
  unpaidTotal: number;
  paidCount: number;
  unpaidCount: number;
  unpaidOrders: { order: string; cost: number }[];
  orders: SupplierOrderRow[];
  stores: { id: string; label: string }[];
  storeId: string | null;
}
export async function getSupplierData(): Promise<SupplierData | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = await createClient();
  const [{ data: settings, error }, stores, applied] = await Promise.all([
    db
      .from("settings")
      .select("supplier_sheet_url,currency")
      .eq("user_id", user.id)
      .single(),
    selectAllByUser<Tables<"shopify_connections">>(
      db,
      "shopify_connections",
      "id,shop_name,shop_domain",
      user.id,
    ),
    selectAllByUser<Tables<"order_supplier_costs">>(
      db,
      "order_supplier_costs",
      "shopify_connection_id",
      user.id,
    ),
  ]);
  if (error) throw error;
  const savedStores = [...new Set(applied.map((r) => r.shopify_connection_id))];
  const base: SupplierData = {
    url: settings?.supplier_sheet_url ?? null,
    currency: settings?.currency ?? "EUR",
    paidTotal: 0,
    unpaidTotal: 0,
    paidCount: 0,
    unpaidCount: 0,
    unpaidOrders: [],
    orders: [],
    stores: stores.map((s) => ({
      id: s.id,
      label: s.shop_name ?? s.shop_domain,
    })),
    storeId:
      stores.length === 1
        ? stores[0].id
        : savedStores.length === 1
          ? savedStores[0]
          : null,
  };
  if (!base.url) return base;
  const costs = await fetchSupplierCosts(base.url);
  if (!costs)
    return {
      ...base,
      error: "Não consegui ler a sheet. Confirma a partilha e o separador.",
    };
  const orders = [...costs.byOrder.values()].sort(
    (a, b) => Number(a.order) - Number(b.order),
  );
  return {
    ...base,
    currency: costs.currency ?? base.currency,
    error: costs.errors.length ? costs.errors.join(" ") : undefined,
    paidTotal: costs.paidTotal,
    unpaidTotal: costs.unpaidTotal,
    paidCount: costs.paidCount,
    unpaidCount: costs.unpaidCount,
    orders,
    unpaidOrders: orders
      .filter((r) => !r.paid)
      .reverse()
      .map((r) => ({ order: r.order, cost: r.cost })),
  };
}
