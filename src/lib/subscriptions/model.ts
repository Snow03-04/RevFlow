import { z } from "zod";
import type { Database } from "@/types/database";

export type StoreSubscription = Database["public"]["Tables"]["store_subscriptions"]["Row"];
export const CYCLES = { weekly: "Semanal", monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual" } as const;
export const STATUSES = { active: "Ativa", trial: "Período gratuito", paused: "Em pausa", cancelled: "Cancelada" } as const;
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= "2200-12-31";
}, "Indica uma data válida.");
export const subscriptionSchema = z.object({
  id: z.string().uuid().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  shopify_connection_id: z.string().uuid("Seleciona uma loja."),
  name: z.string().trim().min(1, "Indica o nome do serviço.").max(100),
  amount: z.number().finite().min(0).max(9999999).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, "Usa até duas casas decimais."),
  currency: z.enum(["EUR", "USD", "GBP", "CAD", "AUD", "RON", "HUF", "PLN", "CZK", "SEK", "DKK", "NOK", "CHF"]),
  billing_cycle: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  status: z.enum(["active", "trial", "paused", "cancelled"]),
  next_due_date: dateSchema,
  reminder_days: z.number().int().min(0).max(90),
  management_url: z.string().trim().max(2000).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  }, "Usa uma ligação http ou https válida."),
  notes: z.string().trim().max(2000),
}).strict().refine(v => !v.id || !!v.expectedUpdatedAt, "Reabre a subscrição antes de a editar.");
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

export function daysUntil(due: string, today: string) {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
export function isRunning(s: Pick<StoreSubscription, "status">) { return s.status === "active" || s.status === "trial"; }
export function nextRenewalDate(s: Pick<StoreSubscription, "next_due_date" | "billing_cycle" | "anchor_day">) {
  const [y, m, d] = s.next_due_date.split("-").map(Number);
  if (s.billing_cycle === "weekly") return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  const months = s.billing_cycle === "monthly" ? 1 : s.billing_cycle === "quarterly" ? 3 : 12;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(s.anchor_day, last));
  return target.toISOString().slice(0, 10);
}
export function dueLabel(s: Pick<StoreSubscription, "status" | "next_due_date">, today: string) {
  const days = daysUntil(s.next_due_date, today), trial = s.status === "trial";
  if (days < 0) return trial ? `Período gratuito terminou há ${-days} ${days === -1 ? "dia" : "dias"}` : `Renovação por confirmar há ${-days} ${days === -1 ? "dia" : "dias"}`;
  const when = days === 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dias`;
  return trial ? `Período gratuito termina ${when}` : `Renovação ${when}`;
}
export function alertKey(s: Pick<StoreSubscription, "status" | "next_due_date" | "reminder_days">, today: string) {
  const days = daysUntil(s.next_due_date, today);
  if (!isRunning(s) || days > s.reminder_days) return null;
  return `${s.status}:${s.next_due_date}:${days < 0 ? "overdue" : days === 0 ? "today" : "upcoming"}`;
}
export type SubscriptionAlert = { id: string; key: string; name: string; store: string; dueDate: string; label: string; overdue: boolean; unread: boolean };
export function subscriptionAlerts(rows: StoreSubscription[], stores: Map<string, string>, today: string): SubscriptionAlert[] {
  return rows.flatMap(s => {
    const key = alertKey(s, today);
    return key ? [{ id: s.id, key, name: s.name, store: stores.get(s.shopify_connection_id) ?? "Loja", dueDate: s.next_due_date,
      label: dueLabel(s, today), overdue: daysUntil(s.next_due_date, today) < 0, unread: s.read_alert_key !== key }] : [];
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}
export function monthlyTotals(rows: StoreSubscription[]) {
  const totals: Record<string, number> = {};
  for (const s of rows.filter(isRunning)) {
    const factor = s.billing_cycle === "weekly" ? 52 / 12 : s.billing_cycle === "quarterly" ? 1 / 3 : s.billing_cycle === "yearly" ? 1 / 12 : 1;
    totals[s.currency] = (totals[s.currency] ?? 0) + Number(s.amount) * factor;
  }
  return Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
}
