import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncShopifyConnection,
  syncMetaConnection,
  syncGoogleConnection,
} from "@/lib/jobs";
import { projectPnlMonth, currentPnlMonth } from "@/lib/trackers/pnl-import";
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
  };

  const { data: shopifyConns } = await admin
    .from("shopify_connections")
    .select("*")
    .in("status", ["active", "error"]); // retry errored connections so they heal

  for (const conn of shopifyConns ?? []) {
    try {
      await syncShopifyConnection(admin, conn, { sinceDays: 2 });
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
      await syncMetaConnection(admin, conn, { sinceDays: 3 });
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
      await syncGoogleConnection(admin, conn, { sinceDays: 3 });
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

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), summary });
}
