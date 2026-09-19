import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getPnlSettings, getPnlYear } from "@/lib/trackers/queries";
import type { PnlFees } from "@/lib/trackers/pnl";
import { GoogleFinancePage } from "./google-finance-page";
import { MetaFinancePage } from "./meta-finance-page";
export type FinanceParams = { month?: string; view?: string; store?: string; campaign?: string; collection?: string };

export async function FinancePlatformPage({ platform, searchParams }: { platform: "meta" | "google"; searchParams: Promise<FinanceParams> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await createClient();
  const sp = await searchParams;
  const settings = await getPnlSettings(db, user.id);
  const year = settings.base_year;
  const currency = settings.currency;
  const annual = sp.view === "dashboard";
  const month = Math.min(12, Math.max(1, parseInt(sp.month ?? "") || (new Date().getFullYear() === year ? new Date().getMonth() + 1 : 1)));
  const range = { from: annual ? `${year}-01-01` : `${year}-${String(month).padStart(2, "0")}-01`,
    to: annual ? `${year}-12-31` : `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}` };
  const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  const { overrides } = await getPnlYear(db, user.id, year);
  const feesByMonth: PnlFees[] = Array.from({ length: 12 }, (_, i) => {
    const override = overrides.find((o) => o.month === i + 1);
    return { feeFb: Number(override?.agency_fee_fb ?? settings.agency_fee_fb), feeGoogle: Number(override?.agency_fee_google ?? settings.agency_fee_google),
      txFee: Number(override?.transaction_fee ?? settings.transaction_fee), paymentPct: Number(settings.payment_fee_pct ?? 0.025) };
  });
  const common = { year, month: annual ? undefined : month, currency, feesByMonth, query };
  if (platform === "google") return <GoogleFinancePage {...common} db={db} userId={user.id} sp={sp} range={range} />;
  return <MetaFinancePage {...common} db={db} userId={user.id} sp={sp} range={range} />;
}
