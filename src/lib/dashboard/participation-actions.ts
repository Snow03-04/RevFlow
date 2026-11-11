"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adSpendParticipationKey, expenseParticipationKey, participationKey, participationSchema } from "./store-participation";

export async function saveStoreParticipation(storeId: string, input: unknown, expenseOverride?: unknown, adSpendOverride?: unknown) {
  if (!z.string().uuid().safeParse(storeId).success) return { ok: false, error: "Loja inválida." };
  const parsed = participationSchema.safeParse(input);
  const override = participationSchema.nullable().optional();
  const expenses = override.safeParse(expenseOverride);
  const ads = override.safeParse(adSpendOverride);
  if (!parsed.success || !expenses.success || !ads.success) return { ok: false, error: "Indica percentagens entre 0 e 100, com até duas casas decimais." };
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada. Volta a entrar." };
  const { data: store, error } = await db.from("shopify_connections").select("id")
    .eq("user_id", user.id).eq("id", storeId).maybeSingle();
  if (error || !store) return { ok: false, error: "Esta loja não está disponível na tua conta." };
  // Merge one store's preference, preserving other stores and account settings.
  const { error: saveError } = await db.auth.updateUser({ data: {
    [participationKey(storeId)]: parsed.data,
    ...(expenses.data === undefined ? {} : { [expenseParticipationKey(storeId)]: expenses.data }),
    ...(ads.data === undefined ? {} : { [adSpendParticipationKey(storeId)]: ads.data }),
  } });
  if (saveError) return { ok: false, error: "Não foi possível guardar a percentagem. Tenta novamente." };
  revalidatePath("/dashboard");
  return { ok: true };
}
