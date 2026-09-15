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
import { PnlLive } from "@/components/trackers/pnl-live";
import { PnlScopePicker } from "@/components/trackers/pnl-scope-picker";
import { MetaPnlSheet } from "@/components/trackers/meta-pnl-sheet";
import { getMetaPnlCatalog, getMetaPnlDays } from "@/lib/trackers/meta-pnl-query";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "P&L" };
export const dynamic = "force-dynamic";
// The month "Importar" action runs on this route and pulls a wide Shopify/Meta
// window before recomputing; give it headroom above the platform default.
export const maxDuration = 60;

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
  searchParams: Promise<{ view?: string; month?: string; scope?: string; campaign?: string; store?: string }>;
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
  const isMeta = sp.scope === "meta";
  const catalog = await getMetaPnlCatalog(supabase, user.id, year);
  const options = catalog.options.filter((c) => !sp.store || sp.store === "all" || c.storeId === sp.store);
  const campaign = options.find((c) => c.key === sp.campaign);
  const query = new URLSearchParams(Object.entries(sp).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();

  const tabs: { key: string; label: string; href: string }[] = [
    { key: "dashboard", label: "Dashboard", href: pnlUrl(query, { view: "dashboard", month: null }) },
    ...MONTH_NAMES.map((name, i) => ({
      key: `m${i + 1}`,
      label: name.slice(0, 3),
      href: pnlUrl(query, { view: "month", month: String(i + 1) }),
    })),
    { key: "settings", label: "Settings", href: pnlUrl(query, { view: "settings" }) },
  ];
  const activeKey =
    view === "dashboard" ? "dashboard" : view === "settings" ? "settings" : `m${month}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="P&L Profit Sheet"
        description={`Lucro & prejuízo diário · ${year} · moeda ${currency}`}
      />

      <PnlScopePicker options={options} isMeta={isMeta} selectedKey={campaign?.key ?? ""} />

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

      {view === "settings" ? (
        <>
          {isMeta && <p className="text-sm text-muted-foreground">Estas definições aplicam-se à P&L geral e às estimativas por campanha.</p>}
          <PnlSettingsForm settings={settings} />
        </>
      ) : isMeta ? (
        await renderCampaign()
      ) : view === "dashboard" ? (
        await renderDashboard()
      ) : (
        await renderMonth()
      )}
    </div>
  );

  async function renderCampaign() {
    if (!campaign) return <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
      {sp.campaign ? "Esta campanha não está disponível na loja e no ano selecionados. Escolhe outra campanha na lista." : "Seleciona uma campanha Meta para ver a sua P&L mensal ou o resumo anual."}
    </p>;
    const annual = view === "dashboard";
    const from = annual ? `${year}-01-01` : `${year}-${String(month).padStart(2, "0")}-01`;
    const to = annual ? `${year}-12-31` : `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
    const [days, { overrides }] = await Promise.all([
      getMetaPnlDays(supabase, user!.id, catalog.rows, { from, to }, currency),
      getPnlYear(supabase, user!.id, year),
    ]);
    const feesByMonth = Array.from({ length: 12 }, (_, i) => feesFor(overrides.find((o) => o.month === i + 1) ?? null, defaultFees));
    return <MetaPnlSheet campaign={campaign} rows={days.filter((d) => d.key === campaign.key)}
      year={year} month={annual ? undefined : month} currency={currency} feesByMonth={feesByMonth} query={query} />;
  }

  async function renderMonth() {
    const { override, days } = await getPnlMonth(supabase, user!.id, year, month);
    return (
      <>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">{MONTH_NAMES[month - 1]} {year}</h2>
          <PnlLive year={year} month={month} />
        </div>
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
