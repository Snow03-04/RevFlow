"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { googleAccountStateKey, googleAccountStateSchema } from "./account-monitoring";

export async function saveGoogleAccountState(storeId: string, customerId: string, input: unknown) {
  const state = googleAccountStateSchema.safeParse(input);
  if (!z.string().uuid().safeParse(storeId).success || !/^\d{10}$/.test(customerId) || !state.success)
    return { ok: false, error: "Confirma a loja, a conta Google e o estado." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Volta a entrar." };
  const db = await createClient();
  const [store, account] = await Promise.all([
    db.from("shopify_connections").select("id").eq("user_id", user.id).eq("id", storeId).maybeSingle(),
    db.from("google_campaigns").select("id").eq("user_id", user.id).is("google_connection_id", null)
      .like("campaign_id", `script%:${storeId}:${customerId}:%`).limit(1).maybeSingle(),
  ]);
  if (store.error || account.error || !store.data || !account.data)
    return { ok: false, error: "Esta conta Google não está associada à tua loja." };
  // Supabase merges this single preference; no campaign, cost or token changes.
  const { error } = await db.auth.updateUser({ data: { [googleAccountStateKey(storeId, customerId)]: state.data } });
  if (error) return { ok: false, error: "Não foi possível guardar o estado. Tenta novamente." };
  revalidatePath("/connections");
  revalidatePath("/dashboard");
  return { ok: true };
}
