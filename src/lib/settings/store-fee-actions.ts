"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { refreshCostDependents } from "@/lib/cogs/refresh";
import { EU_ORDER_FEE_START } from "@/lib/cogs/eu-order-fee";
import { eachDay, todayYmd } from "@/lib/date";

export interface StoreFeeState { ok?: boolean; error?: string }

export async function updateStoreFeeAction(_prev: StoreFeeState, form: FormData): Promise<StoreFeeState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Inicia sessão para guardar a taxa da loja." };
  const parsed = z.object({ storeId: z.string().uuid(), enabled: z.enum(["true", "false"]) }).safeParse({
    storeId: form.get("store_id"), enabled: form.get("enabled"),
  });
  if (!parsed.success) return { error: "Definição da taxa inválida." };
  const db = await createClient();
  const { data: store, error: readError } = await db.from("shopify_connections").select("id")
    .eq("user_id", user.id).eq("id", parsed.data.storeId).maybeSingle();
  if (readError || !store) return { error: "Não foi possível encontrar esta loja na tua conta." };
  const { data: saved, error } = await db.from("shopify_connections")
    .update({ eu_order_fee_enabled: parsed.data.enabled === "true" })
    .eq("user_id", user.id).eq("id", store.id).select("id").single();
  if (error || !saved) return { error: "Não foi possível guardar a taxa. Tenta novamente." };
  try {
    const { data: settings, error: settingsError } = await db.from("settings").select("timezone").eq("user_id", user.id).single();
    if (settingsError) throw settingsError;
    const to = todayYmd(settings?.timezone ?? "UTC");
    if (to >= EU_ORDER_FEE_START) {
      const dates = eachDay({ from: EU_ORDER_FEE_START, to });
      const months = [...new Set(dates.map(d => d.slice(0, 7)))];
      await refreshCostDependents(db, user.id, { storeId: store.id, dates, months });
    }
  } catch {
    revalidatePath("/settings");
    return { error: "Taxa guardada; falta concluir o recálculo. Carrega em Guardar para tentar novamente." };
  }
  for (const path of ["/settings", "/dashboard", "/pnl", "/roas", "/products", "/cogs-audit"])
    revalidatePath(path);
  revalidatePath("/finance", "layout");
  return { ok: true };
}
