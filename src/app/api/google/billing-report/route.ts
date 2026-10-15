import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest } from "@/lib/sync/request";
import { invalidateSyncedViews } from "@/lib/sync/invalidate";
import { scriptAccountStores } from "@/lib/google/account-expenses";
import { parseGoogleBilledCsv } from "@/lib/google/billing-model";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { projectPnlMonth } from "@/lib/trackers/pnl-import";

export const maxDuration = 300;
const schema = z.object({ storeId: z.string().uuid(), customerId: z.string().regex(/^\d{10}$/), csv: z.string().min(1).max(1_000_000) }).strict();

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Inicia sessão novamente." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 1_100_000) return NextResponse.json({ error: "Ficheiro demasiado grande." }, { status: 413 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Confirma a loja, o número da conta e o ficheiro CSV." }, { status: 400 });
  const { storeId, customerId, csv } = input.data;
  let days;
  try { days = parseGoogleBilledCsv(csv); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  if (days.length > 93 || days.some(d => d.date > new Date().toISOString().slice(0, 10))) return NextResponse.json({ error: "Importa até três meses, sem datas futuras." }, { status: 400 });
  try {
    const db = await createClient();
    const [owners, oauth] = await Promise.all([scriptAccountStores(db, user.id, customerId), db.from("google_connections").select("shopify_connection_id").eq("user_id", user.id).eq("customer_id", customerId)]);
    if (oauth.error) throw oauth.error;
    if (!owners.has(storeId) && !oauth.data.some(c => c.shopify_connection_id === storeId)) return NextResponse.json({ error: "Esta conta Google não está associada à loja selecionada." }, { status: 400 });
    const admin = createAdminClient();
    const { error } = await admin.from("google_billing_reports").upsert(days.map(day => ({ ...day, user_id: user.id, shopify_connection_id: storeId, customer_id: customerId, imported_at: new Date().toISOString() })),
      { onConflict: "user_id,shopify_connection_id,customer_id,date" });
    if (error) throw error;
    const dates = days.map(d => d.date).sort();
    await recomputeDailyMetrics(admin, user.id, { from: dates[0], to: dates.at(-1)! }, { storeId });
    for (const month of new Set(dates.map(d => d.slice(0, 7)))) await projectPnlMonth(admin, user.id, Number(month.slice(0, 4)), Number(month.slice(5)));
    invalidateSyncedViews();
    return NextResponse.json({ ok: true, days: days.length });
  } catch (error) {
    console.error("Google billing report import failed", error);
    return NextResponse.json({ error: "Não foi possível concluir a importação e o recálculo. Podes repetir o mesmo ficheiro sem duplicar custos." }, { status: 500 });
  }
}
