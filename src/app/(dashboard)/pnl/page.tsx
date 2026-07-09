import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getPnlSettings,
  getPnlMonth,
  getPnlYear,
} from "@/lib/trackers/queries";
import {
  MONTH_NAMES,
  summariseMonth,
  type PnlDayInput,
  type PnlFees,
  type MonthSummary,
} from "@/lib/trackers/pnl";
import { PageHeader } from "@/components/dashboard/page-header";
import { PnlSheet } from "@/components/trackers/pnl-sheet";
import { PnlDashboard } from "@/components/trackers/pnl-dashboard";
import { PnlSettingsForm } from "@/components/trackers/pnl-settings-form";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "P&L" };
export const dynamic = "force-dynamic";

function feesFor(
  override: { agency_fee_fb: number | null; agency_fee_google: number | null; transaction_fee: number | null } | null,
  def: PnlFees,
): PnlFees {
  return {
    feeFb: override?.agency_fee_fb != null ? Number(override.agency_fee_fb) : def.feeFb,
    feeGoogle:
      override?.agency_fee_google != null ? Number(override.agency_fee_google) : def.feeGoogle,
    txFee:
      override?.transaction_fee != null ? Number(override.transaction_fee) : def.txFee,
    paymentPct: def.paymentPct, // Shopify % — global, not overridable per month
  };
}

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const settings = await getPnlSettings(supabase, user.id);
  const year = settings.base_year;
  const currency = settings.currency;
  const defaultFees: PnlFees = {
    feeFb: Number(settings.agency_fee_fb),
    feeGoogle: Number(settings.agency_fee_google),
    txFee: Number(settings.transaction_fee),
    paymentPct: Number(settings.payment_fee_pct ?? 0.025),
  };

  const now = new Date();
  const curMonth = now.getFullYear() === year ? now.getMonth() + 1 : 1;
  const view = sp.view ?? "month";
  const month = Math.min(12, Math.max(1, parseInt(sp.month ?? "") || curMonth));

  const tabs: { key: string; label: string; href: string }[] = [
    { key: "dashboard", label: "Dashboard", href: "/pnl?view=dashboard" },
    ...MONTH_NAMES.map((name, i) => ({
      key: `m${i + 1}`,
      label: name.slice(0, 3),
      href: `/pnl?view=month&month=${i + 1}`,
    })),
    { key: "settings", label: "Settings", href: "/pnl?view=settings" },
  ];
  const activeKey =
    view === "dashboard" ? "dashboard" : view === "settings" ? "settings" : `m${month}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="P&L Profit Sheet"
        description={`Lucro & prejuízo diário · ${year} · moeda ${currency}`}
      />

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 scrollbar-thin">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              activeKey === t.key
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "dashboard" ? (
        await renderDashboard()
      ) : view === "settings" ? (
        <PnlSettingsForm settings={settings} />
      ) : (
        await renderMonth()
      )}
    </div>
  );

  async function renderMonth() {
    const { override, days } = await getPnlMonth(supabase, user!.id, year, month);
    return (
      <>
        <h2 className="text-lg font-medium">{MONTH_NAMES[month - 1]} {year}</h2>
        <PnlSheet
          key={`${year}-${month}`}
          year={year}
          month={month}
          currency={currency}
          defaultFees={defaultFees}
          override={override}
          initialDays={days}
        />
      </>
    );
  }

  async function renderDashboard() {
    const { days, overrides } = await getPnlYear(supabase, user!.id, year);
    const overrideByMonth = new Map(overrides.map((o) => [o.month, o]));
    const months: MonthSummary[] = [];
    for (let m = 1; m <= 12; m++) {
      const rows: PnlDayInput[] = days
        .filter((d) => d.month === m)
        .map((d) => ({
          grossRevenue: Number(d.gross_revenue),
          refunds: Number(d.refunds),
          cogs: Number(d.cogs),
          adspendFb: Number(d.adspend_fb),
          adspendGoogle: Number(d.adspend_google),
          orders: Number(d.orders),
        }));
      months.push(summariseMonth(m, rows, feesFor(overrideByMonth.get(m) ?? null, defaultFees)));
    }
    return <PnlDashboard months={months} currency={currency} />;
  }
}
