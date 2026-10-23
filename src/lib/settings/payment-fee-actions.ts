"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { projectPnlMonth } from "@/lib/trackers/pnl-import";
import { projectRoasMonth } from "@/lib/trackers/roas-import";
import { todayYmd, ymdInTz } from "@/lib/date";
import { paymentFeeRefreshSteps, type PaymentFeeRefreshStep } from "./payment-fee-refresh";

export async function saveStorePaymentFees(values: {
  storeId: string; mode: string; percent: number; fixed: number; currency: string;
}): Promise<{ ok: boolean; error?: string; steps?: PaymentFeeRefreshStep[] }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Inicia sessão para guardar." };
  const parsed = z.object({ storeId: z.string().uuid(), mode: z.enum(["inherit", "shopify", "manual"]),
    percent: z.number().finite().min(0).max(100), fixed: z.number().finite().min(0).max(100),
    currency: z.enum(["EUR", "USD", "GBP", "CAD", "RON", "HUF", "PLN", "CZK", "SEK"]) }).strict().safeParse(values);
  if (!parsed.success) return { ok: false, error: "Confirma a loja, a moeda e os valores das taxas." };
  const { storeId, mode, percent, fixed, currency } = parsed.data;
  const db = await createClient();
  const { data, error } = await db.from("shopify_connections").update({ payment_fee_mode: mode,
    payment_fee_pct: mode === "inherit" ? null : percent / 100,
    payment_fee_fixed: mode === "inherit" ? null : fixed,
    payment_fee_currency: mode === "inherit" ? null : currency,
  }).eq("user_id", user.id).eq("id", storeId).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Não foi possível guardar as taxas desta loja." };
  const [settings, firstOrder] = await Promise.all([
    db.from("settings").select("timezone").eq("user_id", user.id).maybeSingle(),
    db.from("orders").select("processed_at").eq("user_id", user.id).eq("shopify_connection_id", storeId)
      .order("processed_at").limit(1).maybeSingle(),
  ]);
  if (settings.error || firstOrder.error)
    return { ok: false, error: "Taxas guardadas; falta concluir o recálculo. Volta a guardar para tentar novamente." };
  const timezone = settings.data?.timezone ?? "UTC";
  const steps = firstOrder.data ? paymentFeeRefreshSteps(ymdInTz(new Date(firstOrder.data.processed_at), timezone), todayYmd(timezone)) : [];
  if (!steps.length) revalidatePath("/pnl", "layout");
  return { ok: true, steps };
}

/** Each step rechecks ownership and reads the saved policy; the browser cannot supply costs or another user. */
export async function refreshStorePaymentFees(values: PaymentFeeRefreshStep & { storeId: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Inicia sessão para concluir o recálculo." };
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });
  const parsed = z.object({ storeId: z.string().uuid(), phase: z.enum(["metrics", "roas", "pnl"]), from: date, to: date }).strict()
    .refine(value => value.from <= value.to && value.from.slice(0, 7) === value.to.slice(0, 7)
      && (Date.parse(value.to) - Date.parse(value.from)) <= 6 * 86400000
      && (value.phase !== "pnl" || (value.from === value.to && value.from.endsWith("-01"))))
    .safeParse(values);
  if (!parsed.success) return { ok: false, error: "Período de recálculo inválido." };
  const { storeId, phase, from, to } = parsed.data;
  const db = await createClient();
  const { data: store, error } = await db.from("shopify_connections").select("id").eq("user_id", user.id).eq("id", storeId).maybeSingle();
  if (error || !store) return { ok: false, error: "Esta loja não está disponível nesta conta." };
  try {
    const year = Number(from.slice(0, 4)), month = Number(from.slice(5, 7));
    if (phase === "metrics") await recomputeDailyMetrics(db, user.id, { from, to }, { storeId });
    else {
      const configured = await db.from(phase === "roas" ? "roas_settings" : "pnl_settings").select("user_id").eq("user_id", user.id).maybeSingle();
      if (configured.error) throw configured.error;
      if (configured.data) {
        if (phase === "roas") await projectRoasMonth(db, user.id, year, month, { fromDay: Number(from.slice(8)), toDay: Number(to.slice(8)), costsOnly: true });
        else await projectPnlMonth(db, user.id, year, month, { costsOnly: true });
      }
    }
  } catch {
    return { ok: false, error: "Taxas guardadas; falta concluir o recálculo. Volta a guardar para tentar novamente." };
  }
  if (phase === "pnl")
    for (const path of ["/pnl", "/dashboard", "/finance", "/payments", "/roas", "/settings"])
      revalidatePath(path, "layout");
  return { ok: true };
}
