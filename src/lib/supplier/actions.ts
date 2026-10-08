"use server";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  fetchSupplierCosts,
  parseSheetRef,
  listSheetTabs,
  type SheetTab,
} from "@/lib/supplier/sheet";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { syncSupplierCosts } from "./sync";
import { supplierConnection } from "./connection";
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
  storeId?: string,
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
    try {
      const result = await syncSupplierCosts(db, user.id, { url: trimmed, storeId, costs });
      for (const path of ["/supplier", "/costs", "/dashboard", "/products", "/pnl", "/roas", "/cogs-audit"])
        revalidatePath(path);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Falha ao ligar a sheet à loja." };
    }
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

/** Explicitly binds this sheet tab to the selected store and enables sync. */
export async function applySupplierCosts(storeId?: string): Promise<SupplierActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const db = await createClient();
  try {
    const result = await syncSupplierCosts(db, user.id, { storeId });
    for (const path of ["/supplier", "/costs", "/cogs-audit", "/dashboard", "/products", "/pnl", "/roas"])
      revalidatePath(path);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : ((error as { message?: string })?.message ?? "Falha ao atualizar os custos.") };
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
  autoSync: boolean;
  pendingRefresh: boolean;
  unpricedCount: number;
  ignoredSummaryCount: number;
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
  const connection = supplierConnection(settings?.supplier_sheet_url);
  const base: SupplierData = {
    url: connection?.url ?? null,
    currency: settings?.currency ?? "EUR",
    paidTotal: 0,
    unpaidTotal: 0,
    paidCount: 0,
    unpaidCount: 0,
    unpaidOrders: [],
    orders: [],
    autoSync: !!connection?.storeId,
    pendingRefresh: connection?.pendingRefresh ?? false,
    unpricedCount: 0,
    ignoredSummaryCount: 0,
    stores: stores.map((s) => ({
      id: s.id,
      label: s.shop_name ?? s.shop_domain,
    })),
    storeId:
      connection?.storeId ?? (stores.length === 1
        ? stores[0].id
        : savedStores.length === 1
          ? savedStores[0]
          : null),
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
    unpricedCount: costs.unpricedOrders.length,
    ignoredSummaryCount: costs.summaryRows?.length ?? 0,
    orders,
    unpaidOrders: orders
      .filter((r) => !r.paid)
      .reverse()
      .map((r) => ({ order: r.order, cost: r.cost })),
  };
}
