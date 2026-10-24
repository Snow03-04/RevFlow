import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getPnlSettings,
  getPnlMonth,
  getPnlYear,
} from "@/lib/trackers/queries";
import {
  MONTH_NAMES,
  summariseMonth,
  pnlMonthGoogleEstimates,
  daysInMonth,
  type PnlDayInput,
  type PnlFees,
  type MonthSummary,
} from "@/lib/trackers/pnl";
import { PageHeader } from "@/components/dashboard/page-header";
import { PnlSheet } from "@/components/trackers/pnl-sheet";
import { PnlDashboard } from "@/components/trackers/pnl-dashboard";
import { PnlSettingsForm } from "@/components/trackers/pnl-settings-form";
import { PnlLive } from "@/components/trackers/pnl-live";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn, storeLabel } from "@/lib/utils";
import { getPnlGoogleEstimates } from "@/lib/trackers/pnl-google-spend";
import { selectAllByUser } from "@/lib/supabase/paginate";
import type { NamedStore } from "@/lib/google/store-labels";
import type { Tables } from "@/types/database";

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
  if (sp.scope === "meta" || sp.scope === "google") {
    const legacy = new URLSearchParams(Object.entries(sp).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    legacy.delete("scope");
    redirect(`/finance/${sp.scope}${legacy.size ? `?${legacy}` : ""}`);
  }

  const [settings, stores] = await Promise.all([
    getPnlSettings(supabase, user.id),
    selectAllByUser<NamedStore>(supabase, "shopify_connections", "id,shop_name,shop_domain", user.id, (q) => q.order("created_at")),
  ]);
  const store = stores.find((store) => store.id === sp.store);
  if (sp.store && sp.store !== "all" && !store) notFound();
  const storeName = store ? storeLabel(store.shop_name, store.shop_domain) : undefined;
  const year = settings.base_year;
  const currency = settings.currency;
  const scope = { storeId: store?.id, currency };
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
  const paymentCoverage = await selectAllByUser<Pick<Tables<"daily_metrics">, "shopify_connection_id" | "orders_count" | "payment_orders_actual" | "payment_orders_estimated" | "supplier_orders_priced" | "supplier_orders_unpriced">>(supabase,
    "daily_metrics", "shopify_connection_id,orders_count,payment_orders_actual,payment_orders_estimated,supplier_orders_priced,supplier_orders_unpriced", user.id,
    q => q.gte("date", view === "dashboard" ? `${year}-01-01` : `${year}-${String(month).padStart(2, "0")}-01`)
      .lte("date", view === "dashboard" ? `${year}-12-31` : `${year}-${String(month).padStart(2, "0")}-${daysInMonth(year, month)}`));
  const coverage = paymentCoverage.filter(r => !store || r.shopify_connection_id === store.id)
    .reduce((n, r) => ({ actual: n.actual + Number(r.payment_orders_actual ?? 0), estimated: n.estimated + Number(r.payment_orders_estimated ?? 0),
      priced: n.priced + Number(r.supplier_orders_priced ?? 0), unpriced: n.unpriced + Number(r.supplier_orders_unpriced ?? 0),
      unknown: n.unknown + (r.supplier_orders_priced == null || r.supplier_orders_unpriced == null ? Number(r.orders_count) : 0),
    }), { actual: 0, estimated: 0, priced: 0, unpriced: 0, unknown: 0 });
  const query = new URLSearchParams(Object.entries(sp).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();

  const tabs: { key: string; label: string; href: string }[] = [
    { key: "dashboard", label: "Resumo anual", href: pnlUrl(query, { view: "dashboard", month: null }) },
    ...MONTH_NAMES.map((name, i) => ({
      key: `m${i + 1}`,
      label: name.slice(0, 3),
      href: pnlUrl(query, { view: "month", month: String(i + 1) }),
    })),
    { key: "settings", label: "Definições", href: pnlUrl(query, { view: "settings" }) },
  ];
  const activeKey =
    view === "dashboard" ? "dashboard" : view === "settings" ? "settings" : `m${month}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="P&L"
        description={`${storeName ?? "Todas as lojas"} · ${year} · ${currency} · Usa o filtro de loja no topo.`}
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

      {view !== "settings" && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-xs">
        <span className="font-medium text-primary">Taxas Shopify automáticas</span>
        <span className="text-muted-foreground">{coverage.actual} pagamentos confirmados{coverage.estimated > 0 ? ` · ${coverage.estimated} com taxa provisória` : ""}</span>
        <Link className="text-muted-foreground underline underline-offset-4" href={`/payments${store ? `?store=${store.id}` : ""}`}>Conferir taxas</Link>
        {coverage.estimated > 0 && <p className="w-full text-muted-foreground">As taxas provisórias são substituídas pelas taxas cobradas quando a Shopify confirmar os pagamentos.</p>}
        <p className="w-full border-t border-border pt-2 text-muted-foreground">
          Custos do fornecedor: {coverage.priced} encomendas com custo indicado
          {coverage.unpriced > 0 ? ` · ${coverage.unpriced} sem custo individual, calculadas com os preços disponíveis ou estimativas` : ""}
          {coverage.unknown > 0 ? ` · ${coverage.unknown} por verificar` : ""}.
          {(coverage.unpriced > 0 || coverage.unknown > 0) && <span className="text-amber-400"> Lucro provisório até confirmar estes custos.</span>}
          {store && <> <Link className="text-primary underline underline-offset-4" href={`/cogs-audit?store=${store.id}`}>Conferir encomendas</Link>.</>}
        </p>
      </div>}

      {view === "settings" ? (
        <>
          <PnlSettingsForm settings={settings} />
        </>
      ) : view === "dashboard" ? (
        await renderDashboard()
      ) : (
        await renderMonth()
      )}
    </div>
  );

  async function renderMonth() {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const [{ override, days }, estimates] = await Promise.all([
      getPnlMonth(supabase, user!.id, year, month, scope),
      getPnlGoogleEstimates(supabase, user!.id, { from: `${prefix}-01`, to: `${prefix}-${daysInMonth(year, month)}` }, currency, store?.id),
    ]);
    return (
      <>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">{MONTH_NAMES[month - 1]} {year}</h2>
          <PnlLive key={store?.id ?? "all"} year={year} month={month} storeId={store?.id} />
        </div>
        <PnlSheet
          key={`${year}-${month}-${store?.id ?? "all"}`}
          year={year}
          month={month}
          currency={currency}
          defaultFees={defaultFees}
          override={override}
          initialDays={days}
          readOnly
          storeId={store?.id}
          googleEstimates={pnlMonthGoogleEstimates(estimates, year, month)}
        />
      </>
    );
  }

  async function renderDashboard() {
    const [{ days, overrides }, estimates] = await Promise.all([
      getPnlYear(supabase, user!.id, year, scope),
      getPnlGoogleEstimates(supabase, user!.id, { from: `${year}-01-01`, to: `${year}-12-31` }, currency, store?.id),
    ]);
    const overrideByMonth = new Map(overrides.map((o) => [o.month, o]));
    const months: MonthSummary[] = [];
    for (let m = 1; m <= 12; m++) {
      const estimated = pnlMonthGoogleEstimates(estimates, year, m);
      const byDay = new Map(days.filter((d) => d.month === m).map((d) => [d.day, d]));
      // Include imported ad-only days even before the next stored projection.
      const rows: PnlDayInput[] = Array.from({ length: daysInMonth(year, m) }, (_, i) => {
        const d = byDay.get(i + 1);
        return {
          paymentFees: d?.payment_fees == null ? undefined : Number(d.payment_fees),
          paymentAdjustment: Number(d?.payment_adjustment ?? 0),
          euOrderFees: Number(d?.eu_order_fees ?? 0),
          grossRevenue: Number(d?.gross_revenue ?? 0),
          refunds: Number(d?.refunds ?? 0),
          cogs: Number(d?.cogs ?? 0),
          adspendFb: Number(d?.adspend_fb ?? 0),
          adspendGoogle: Number(d?.adspend_google ?? 0) + (estimated[i + 1] ?? 0),
          orders: Number(d?.orders ?? 0),
        };
      });
      months.push(summariseMonth(m, rows, feesFor(overrideByMonth.get(m) ?? null, defaultFees)));
    }
    return <PnlDashboard months={months} currency={currency} />;
  }
}
