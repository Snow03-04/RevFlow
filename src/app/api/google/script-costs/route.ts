import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleScriptToken } from "@/lib/google/script";
import { safeEqual } from "@/lib/crypto";
import { resolveFx } from "@/lib/fx";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { projectPnlMonth } from "@/lib/trackers/pnl-import";
import { round2 } from "@/lib/profit";
import { storeLabel } from "@/lib/utils";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const Body = z.object({
  user: z.string().uuid(),
  store: z.string().uuid(),
  token: z.string().min(1),
  currency: z.string().length(3).optional(),
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        cost: z.number().finite().min(0),
      }),
    )
    .min(1)
    .max(62),
});

/** "53.89" → "53,89" — the format the hand-typed despesas already use. */
function formatAmount(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/**
 * Receives a store's daily Google Ads cost from the Google Ads Script (see
 * lib/google/script.ts) and keeps exactly one "Google <store> …" despesa per
 * day in step with it: inserts missing days, corrects changed amounts, and
 * drops duplicates for the same day (they would double-count the spend).
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  const { user, store, token, currency, days } = parsed.data;

  if (!safeEqual(token, googleScriptToken(user, store))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const [{ data: shop }, { data: settings }] = await Promise.all([
    admin
      .from("shopify_connections")
      .select("shop_name, shop_domain")
      .eq("id", store)
      .eq("user_id", user)
      .maybeSingle(),
    admin
      .from("settings")
      .select("currency")
      .eq("user_id", user)
      .maybeSingle(),
  ]);
  if (!shop) {
    return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });
  }

  // Manual entries are stored in the display currency (see addManualEntry).
  const displayCurrency = settings?.currency ?? "USD";
  const fx = await resolveFx(currency ?? displayCurrency, displayCurrency, {
    required: true,
  });

  const prefix = `Google ${storeLabel(shop.shop_name, shop.shop_domain)}`;
  const likePrefix = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);

  // Never book a day that hasn't started yet anywhere (clock skew / bad input).
  const latest = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
  const wanted = days.filter((d) => d.date <= latest);
  if (wanted.length === 0) return NextResponse.json({ ok: true, changed: 0 });

  const dates = wanted.map((d) => d.date).sort();
  const { data: existing, error: readErr } = await admin
    .from("manual_entries")
    .select("id, date, amount")
    .eq("user_id", user)
    .eq("kind", "expense")
    .gte("date", dates[0])
    .lte("date", dates[dates.length - 1])
    .ilike("label", `${likePrefix}%`)
    .order("created_at", { ascending: true });
  if (readErr) {
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }

  const summary = { inserted: 0, updated: 0, removed: 0, unchanged: 0 };
  const changed: string[] = [];

  for (const day of wanted) {
    const amount = round2(day.cost * fx);
    const label = `${prefix} ${formatAmount(amount)}`;
    const [keep, ...extras] = (existing ?? []).filter((e) => e.date === day.date);

    if (!keep) {
      if (amount <= 0) continue; // no spend, nothing to book
      const { error } = await admin.from("manual_entries").insert({
        user_id: user,
        date: day.date,
        kind: "expense",
        amount,
        currency: displayCurrency,
        label,
      });
      if (error) throw error;
      summary.inserted++;
      changed.push(day.date);
      continue;
    }

    let dayChanged = false;
    if (round2(Number(keep.amount)) !== amount) {
      const { error } = await admin
        .from("manual_entries")
        .update({ amount, currency: displayCurrency, label })
        .eq("id", keep.id);
      if (error) throw error;
      summary.updated++;
      dayChanged = true;
    }
    if (extras.length > 0) {
      const { error } = await admin
        .from("manual_entries")
        .delete()
        .in("id", extras.map((e) => e.id));
      if (error) throw error;
      summary.removed += extras.length;
      dayChanged = true;
    }
    if (dayChanged) changed.push(day.date);
    else summary.unchanged++;
  }

  // Fold the new spend into daily_metrics and the P&L sheet right away. If this
  // runs out of time the entries are already saved and the 15-min cron catches up.
  let recomputed: { from: string; to: string } | null = null;
  if (changed.length > 0) {
    changed.sort();
    recomputed = { from: changed[0], to: changed[changed.length - 1] };
    try {
      await recomputeDailyMetrics(admin, user, recomputed);
      const { data: pnl } = await admin
        .from("pnl_settings")
        .select("user_id")
        .eq("user_id", user)
        .maybeSingle();
      if (pnl) {
        const months = new Set(changed.map((d) => d.slice(0, 7)));
        for (const ym of months) {
          await projectPnlMonth(admin, user, Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));
        }
      }
    } catch {
      // cron will retry
    }
  }

  return NextResponse.json({ ok: true, ...summary, recomputed });
}
