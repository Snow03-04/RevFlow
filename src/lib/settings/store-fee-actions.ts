"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { refreshCostDependents } from "@/lib/cogs/refresh";
import { relearnSupplierPrices } from "@/lib/supplier/sync";

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
    // The fee applies to the whole history (EUR 3 before EU_ORDER_FEE_START, then
    // EUR 5), and the sheet prices learned from it change with the setting.
    await relearnSupplierPrices(db, user.id, store.id);
    await refreshCostDependents(db, user.id, { storeId: store.id });
  } catch {
    revalidatePath("/settings");
    return { error: "Taxa guardada; falta concluir o recálculo. Carrega em Guardar para tentar novamente." };
  }
  for (const path of ["/settings", "/dashboard", "/pnl", "/roas", "/products", "/cogs-audit"])
    revalidatePath(path);
  revalidatePath("/finance", "layout");
  return { ok: true };
}
