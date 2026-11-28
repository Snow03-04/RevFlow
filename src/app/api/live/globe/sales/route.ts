import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { readSalesReport } from "@/lib/shopify/sales-report";
import { globeSales } from "@/lib/live/sales";
import { addDaysYmd, todayYmd } from "@/lib/date";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Inicia sessão." }, { status: 401, headers });
  try {
    const db = await createClient();
    const { data, error } = await db.from("settings").select("timezone").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    const day = todayYmd(data?.timezone || "UTC");
    return Response.json(globeSales(await readSalesReport(db, user.id, { from: addDaysYmd(day, -7), to: day }), day), { headers });
  } catch {
    return Response.json({ error: "Vendas Shopify por confirmar." }, { status: 503, headers });
  }
}
