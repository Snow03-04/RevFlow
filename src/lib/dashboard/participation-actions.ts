"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { participationKey, participationSchema } from "./store-participation";

export async function saveStoreParticipation(storeId: string, input: unknown) {
  if (!z.string().uuid().safeParse(storeId).success) return { ok: false, error: "Loja inválida." };
  const parsed = participationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Indica uma percentagem entre 0 e 100, com até duas casas decimais." };
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada. Volta a entrar." };
  const { data: store, error } = await db.from("shopify_connections").select("id")
    .eq("user_id", user.id).eq("id", storeId).maybeSingle();
  if (error || !store) return { ok: false, error: "Esta loja não está disponível na tua conta." };
  // Merge one store's preference, preserving other stores and account settings.
  const { error: saveError } = await db.auth.updateUser({ data: { [participationKey(storeId)]: parsed.data } });
  if (saveError) return { ok: false, error: "Não foi possível guardar a percentagem. Tenta novamente." };
  revalidatePath("/dashboard");
  return { ok: true };
}
