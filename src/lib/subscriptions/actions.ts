"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { alertKey, dateSchema, isRunning, nextRenewalDate, subscriptionSchema } from "./model";
import { todayYmd } from "@/lib/date";

const conflict = "O registo foi alterado. Atualiza a página e tenta novamente.";
const failed = "Não foi possível guardar. Tenta novamente.";
export async function saveSubscription(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Inicia sessão para guardar." };
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Confirma os campos." };
  const { id, expectedUpdatedAt, ...values } = parsed.data;
  const db = await createClient();
  const store = await db.from("shopify_connections").select("id").eq("user_id", user.id).eq("id", values.shopify_connection_id).maybeSingle();
  if (store.error || !store.data) return { ok: false, error: "Seleciona uma loja desta conta." };
  let anchor = Number(values.next_due_date.slice(8));
  if (id) {
    const old = await db.from("store_subscriptions").select("next_due_date,anchor_day").eq("user_id", user.id).eq("id", id).maybeSingle();
    if (old.error || !old.data) return { ok: false, error: conflict };
    if (old.data.next_due_date === values.next_due_date) anchor = old.data.anchor_day;
  }
  const payload = { ...values, anchor_day: anchor, read_alert_key: null, updated_at: new Date().toISOString() };
  const result = id
    ? await db.from("store_subscriptions").update(payload).eq("user_id", user.id).eq("id", id).eq("updated_at", expectedUpdatedAt!).select("id").maybeSingle()
    : await db.from("store_subscriptions").insert({ ...payload, user_id: user.id }).select("id").single();
  if (result.error || !result.data) return { ok: false, error: id && !result.error ? conflict : failed };
  revalidatePath("/subscriptions");
  return { ok: true };
}

export async function confirmSubscriptionRenewal(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Inicia sessão para guardar." };
  const parsed = z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Subscrição inválida." };
  const db = await createClient();
  const current = await db.from("store_subscriptions").select("*").eq("user_id", user.id).eq("id", parsed.data.id).maybeSingle();
  if (current.error || !current.data || !isRunning(current.data)) return { ok: false, error: "Esta subscrição não está ativa." };
  const next = nextRenewalDate(current.data);
  if (!dateSchema.safeParse(next).success) return { ok: false, error: "Edita a próxima data de renovação." };
  const result = await db.from("store_subscriptions").update({ status: "active", next_due_date: next,
    read_alert_key: null, updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt).select("id").maybeSingle();
  if (result.error || !result.data) return { ok: false, error: result.error ? failed : conflict };
  revalidatePath("/subscriptions");
  return { ok: true };
}

export async function readSubscriptionAlert(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Inicia sessão para continuar." };
  const parsed = z.object({ id: z.string().uuid(), key: z.string().max(100) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Aviso inválido." };
  const db = await createClient();
  const [sub, settings] = await Promise.all([
    db.from("store_subscriptions").select("*").eq("user_id", user.id).eq("id", parsed.data.id).maybeSingle(),
    db.from("settings").select("timezone").eq("user_id", user.id).maybeSingle(),
  ]);
  if (sub.error || settings.error || !sub.data) return { ok: false, error: failed };
  if (alertKey(sub.data, todayYmd(settings.data?.timezone || "Europe/Lisbon")) !== parsed.data.key)
    return { ok: false, error: "Este aviso mudou. Atualiza as notificações." };
  const result = await db.from("store_subscriptions").update({ read_alert_key: parsed.data.key }).eq("user_id", user.id)
    .eq("id", sub.data.id).eq("updated_at", sub.data.updated_at).select("id").maybeSingle();
  return result.error || !result.data ? { ok: false, error: failed } : { ok: true };
}
