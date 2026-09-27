"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { historyKey, storeHistorySchema } from "./lifetime";

export async function saveStoreHistory(storeId: string, input: unknown) {
  if (!z.string().uuid().safeParse(storeId).success) return { ok: false, error: "Loja inválida." };
  const parsed = storeHistorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revê os períodos." };
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada. Volta a entrar." };
  const { data: store, error } = await db.from("shopify_connections").select("id").eq("user_id", user.id).eq("id", storeId).maybeSingle();
  if (error || !store) return { ok: false, error: "Esta loja não está disponível na tua conta." };
  // Small, private reporting preferences. Supabase merges this one key, so other
  // store histories and unrelated user metadata are preserved. No admin client.
  const { error: saveError } = await db.auth.updateUser({ data: { [historyKey(storeId)]: parsed.data } });
  if (saveError) return { ok: false, error: "Não foi possível guardar o histórico. Tenta novamente." };
  revalidatePath("/finance/desde-sempre");
  return { ok: true };
}
