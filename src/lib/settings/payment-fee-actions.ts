"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { refreshCostDependents } from "@/lib/cogs/refresh";

export async function saveStorePaymentFees(values: {
  storeId: string; mode: string; percent: number; fixed: number; currency: string;
}): Promise<{ ok: boolean; error?: string }> {
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
  try {
    await refreshCostDependents(db, user.id, { storeId });
  } catch {
    return { ok: false, error: "Taxas guardadas; falta concluir o recálculo. Volta a guardar para tentar novamente." };
  }
  for (const path of ["/pnl", "/dashboard", "/finance", "/payments", "/roas", "/settings"])
    revalidatePath(path, "layout");
  return { ok: true };
}
