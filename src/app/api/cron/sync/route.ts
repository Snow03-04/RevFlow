import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncShopifyConnection,
  syncMetaConnection,
  syncGoogleConnection,
} from "@/lib/jobs";
import { projectPnlMonth, currentPnlMonth } from "@/lib/trackers/pnl-import";
import { projectRoasMonth, currentRoasMonth } from "@/lib/trackers/roas-import";
import { serverEnv } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";

// Cron jobs can run long; bump the limit (requires Vercel Pro for full 300s).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Scheduled sync (every 15 min via vercel.json). Re-syncs every active
 * Shopify + Meta connection and refreshes daily metrics.
 *
 * Auth: Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is configured. Manual callers must send the same header.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  if (!safeEqual(auth, expected)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const summary = {
    shopify: { ok: 0, failed: 0 },
    meta: { ok: 0, failed: 0 },
    google: { ok: 0, failed: 0 },
    pnl: { ok: 0, failed: 0 },
    roas: { ok: 0, failed: 0 },
  };

  // Rolling window this background pass re-pulls. It is deliberately WIDER than
  // the few days that actually changed: whenever the scheduled function stops
  // firing for a while (a bad deploy, a platform incident, a paused site), every
  // day inside that outage is skipped forever with a narrow window — the next
  // run only looks at the last 2-3 days, so the gap never heals and the sheet
  // shows a day with real orders but €0 ad spend. A week of overlap lets an
  // outage of up to ~5 days repair itself on the next successful run. Nobody is
  // waiting on this request (maxDuration 300), so the extra pull is cheap
  // insurance; the user-facing "Sync now" stays narrow to stay fast.
  const CRON_SINCE_DAYS = 7;

  const { data: shopifyConns } = await admin
    .from("shopify_connections")
    .select("*")
    .in("status", ["active", "error"]); // retry errored connections so they heal

  for (const conn of shopifyConns ?? []) {
    try {
      await syncShopifyConnection(admin, conn, { sinceDays: CRON_SINCE_DAYS });
      summary.shopify.ok++;
    } catch {
      summary.shopify.failed++;
    }
  }

  const { data: metaConns } = await admin
    .from("meta_connections")
    .select("*")
    .in("status", ["active", "error"]);

  for (const conn of metaConns ?? []) {
    try {
      await syncMetaConnection(admin, conn, { sinceDays: CRON_SINCE_DAYS });
      summary.meta.ok++;
    } catch {
      summary.meta.failed++;
    }
  }

  const { data: googleConns } = await admin
    .from("google_connections")
    .select("*")
    .in("status", ["active", "error"]);

  for (const conn of googleConns ?? []) {
    try {
      await syncGoogleConnection(admin, conn, { sinceDays: CRON_SINCE_DAYS });
      summary.google.ok++;
    } catch {
      summary.google.failed++;
    }
  }

  // Keep each P&L sheet's CURRENT month in step with the metrics just synced,
  // so the sheet fills itself in over the day instead of waiting for someone to
  // press "Importar". This is a pure projection off daily_metrics (no external
  // calls), and it runs here in the background — no page or menu ever pays for
  // it. Past months are left alone; those are refreshed on demand.
  const { data: pnlUsers } = await admin
    .from("pnl_settings")
    .select("user_id");

  for (const p of pnlUsers ?? []) {
    try {
      const target = await currentPnlMonth(admin, p.user_id);
      if (!target) continue; // no sheet, or the sheet is for another year
      await projectPnlMonth(admin, p.user_id, target.year, target.month);
      summary.pnl.ok++;
    } catch {
      summary.pnl.failed++;
    }
  }

  // Same idea for the ROAS tracker: project the current month off the Meta
  // campaigns just synced, so each day's grid fills itself in without anyone
  // pressing "Importar". Pure projection — no extra external calls. Only users
  // who have opened the tracker (a roas_settings row exists) are processed.
  const { data: roasUsers } = await admin
    .from("roas_settings")
    .select("user_id");

  for (const r of roasUsers ?? []) {
    try {
      const { year, month } = await currentRoasMonth(admin, r.user_id);
      await projectRoasMonth(admin, r.user_id, year, month);
      summary.roas.ok++;
    } catch {
      summary.roas.failed++;
    }
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), summary });
}
