"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, ArrowRight, Archive, CircleAlert, Layers3, Minus, ShoppingBag } from "lucide-react";
import type { CSSProperties } from "react";
import type { StoreParticipationReport, buildStoreOverview } from "@/lib/dashboard/report";
import { dashboardStoreUrl } from "@/lib/dashboard-navigation";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "@/lib/utils";
import { CountUp } from "./count-up";
import styles from "./store-overview.module.css";

export type OverviewStore = { id: string; name: string; domain: string; status?: string; inactive?: boolean };
type Overview = ReturnType<typeof buildStoreOverview>;

function ProfitLine({ report }: { report: StoreParticipationReport }) {
  const values = report.series.map((point) => point.profit);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const span = high - low || 1;
  const y = (value: number) => 58 - (value - low) / span * 46;
  const points = values.map((value, index) => [values.length === 1 ? 150 : 4 + index / (values.length - 1) * 292, y(value)]);
  const path = points.map(([x, py], index) => `${index ? "L" : "M"}${x.toFixed(2)},${py.toFixed(2)}`).join(" ");
  const zero = high === low ? 35 : y(0);
  return <svg viewBox="0 0 300 70" className={styles.sparkline} role="img" aria-label={values.length === 1 ? "Lucro do dia selecionado" : `Lucro diário nos ${values.length} dias selecionados`}>
    <line x1="4" x2="296" y1={zero} y2={zero} stroke="currentColor" strokeOpacity=".16" strokeDasharray="3 5" />
    {points.length > 1 && <>
      <path d={`${path} L296,${zero} L4,${zero} Z`} fill="currentColor" opacity=".055" />
      <path className={styles.drawLine} d={high === low ? "M4,35 L296,35" : path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </>}
    {points.length > 0 && <circle cx={points.at(-1)![0]} cy={high === low ? 35 : points.at(-1)![1]} r="3.5" fill="currentColor" />}
  </svg>;
}

function StoreCard({ store, report, index, currency, pendingGoogle }: {
  store: OverviewStore; report: StoreParticipationReport; index: number; currency: string; pendingGoogle: boolean;
}) {
  const search = useSearchParams();
  const current = report.current;
  const delta = current.profit - report.previous.profit;
  const personal = report.percentage !== 100;
  const inactive = store.inactive ?? (!!store.status && !["active", "error"].includes(store.status));
  const sign = current.profit > 0 ? "positive" : current.profit < 0 ? "negative" : "neutral";
  const initials = store.name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("");
  const DeltaIcon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  return <article className={styles.card} data-sign={sign} data-store-id={store.id} data-inactive={inactive}
    style={{ "--card-index": Math.min(index, 8), "--card-drift": `${(index % 3 - 1) * 24}px`, "--store-hue": (185 + index * 41) % 360 } as CSSProperties}>
    <div className={styles.cardTop}>
      <div className={styles.identity}>
        <span className={styles.monogram} aria-hidden="true">{initials}</span>
        <div className="min-w-0"><h3 className={styles.storeName}>{store.name}</h3><p className={styles.domain}>{store.domain}</p></div>
      </div>
      {inactive ? <span className={styles.status}><Archive size={11} />{store.status === "revoked" ? "Histórico" : "Desativada"}</span>
        : personal ? <span className={styles.status}>{report.percentage}% teu</span> : null}
    </div>
    <div className={styles.profitBlock}>
      <p className={styles.eyebrow}>{personal ? "O meu lucro estimado" : "Lucro estimado"}</p>
      <CountUp className={styles.profit} value={current.profit} currency={currency} />
      <div className={styles.delta} data-direction={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
        <DeltaIcon size={14} aria-hidden="true" />
        <span>{delta > 0 ? "+" : ""}{formatCurrency(delta, currency)}</span>
        <span className={styles.deltaCaption}>vs. período anterior</span>
      </div>
    </div>
    <ProfitLine report={report} />
    <dl className={styles.metrics}>
      <div><dt>Receita</dt><dd>{formatCurrency(current.revenue, currency)}</dd></div>
      <div><dt>Margem da loja</dt><dd>{current.revenue > 0 ? formatPercent(report.total.profitMargin) : "—"}</dd></div>
      <div><dt>{personal ? "A minha publicidade" : "Publicidade"}</dt><dd>{formatCurrency(current.adSpend, currency)}</dd></div>
      <div><dt>Encomendas</dt><dd>{formatNumber(current.ordersCount)}<span className={styles.units}> · {formatNumber(current.unitsSold)} itens</span></dd></div>
    </dl>
    <div className={styles.cardFoot}>
      <span>{personal ? `Loja: ${formatCurrency(report.total.profit, currency)} de lucro` : `ROAS ${current.adSpend > 0 ? formatMultiplier(report.total.roas) : "—"}`}</span>
      <Link href={dashboardStoreUrl(search.toString(), store.id)} aria-label={`Ver dashboard de ${store.name}`} className={styles.openStore}>Abrir loja <ArrowRight size={13} /></Link>
    </div>
    {(pendingGoogle || report.googleEstimatedAmount > 0) && <p className={styles.notice}><CircleAlert size={12} />{pendingGoogle ? "Google por confirmar · lucro provisório" : "Inclui gasto Google estimado"}</p>}
  </article>;
}

export function StoreOverview({ data, stores, currency, pendingStoreIds = [] }: {
  data: Overview; stores: OverviewStore[]; currency: string; pendingStoreIds?: string[];
}) {
  const byId = new Map(stores.map((store) => [store.id, store]));
  const personal = data.stores.some((store) => store.percentage !== 100);
  const active = data.stores.filter((report) => {
    const store = byId.get(report.storeId);
    if (store?.inactive !== undefined) return !store.inactive;
    const status = store?.status;
    return !status || status === "active" || status === "error";
  });
  const disconnected = data.stores.filter((report) => !active.includes(report));
  const winning = data.stores.filter((store) => store.current.profit > 0).length;
  const losing = data.stores.filter((store) => store.current.profit < 0).length;
  return <section className={styles.overview} aria-label="Resultados de todas as lojas">
    <header className={styles.summary}>
      <div className={styles.intro}><p className={styles.kicker}><Layers3 size={13} /> VISÃO POR LOJAS</p><h2>O teu negócio,<br /><span>loja a loja.</span></h2><p>Ativas: com encomendas nas últimas 72 horas.</p></div>
      <div className={styles.summaryProfit} data-negative={data.current.profit < 0}>
        <p className={styles.eyebrow}>{personal ? "O meu lucro total estimado" : "Lucro total estimado"}</p>
        <CountUp value={data.current.profit} currency={currency} className={styles.totalProfit} />
        <div className={styles.performancePills}><span><i />{winning} com lucro</span>{losing > 0 && <span data-loss="true"><i />{losing} com prejuízo</span>}<span className={styles.storeCount}>{active.length} {active.length === 1 ? "ativa" : "ativas"}{disconnected.length > 0 ? ` · ${disconnected.length} ${disconnected.length === 1 ? "desativada" : "desativadas"}` : ""}</span></div>
      </div>
      <dl className={styles.summaryStats}><div><dt>Receita total</dt><dd>{formatCurrency(data.current.revenue, currency)}</dd></div><div><dt><ShoppingBag size={11} /> Encomendas</dt><dd>{formatNumber(data.current.ordersCount)}</dd></div></dl>
    </header>
    <section aria-label="Lojas ativas">
      <div className={styles.groupHeading}><h3><span className={styles.activeDot} />Lojas ativas</h3><span>{active.length}</span></div>
      <div className={styles.grid}>
      {active.map((report, index) => <StoreCard key={report.storeId} report={report} index={index} currency={currency}
        store={byId.get(report.storeId) ?? { id: report.storeId, name: "Loja", domain: "" }} pendingGoogle={pendingStoreIds.includes(report.storeId)} />)}
      </div>
      {!active.length && <p className={styles.footnote}>Não tens lojas ativas neste momento.</p>}
    </section>
    {disconnected.length > 0 && <section className={styles.disconnected} aria-label="Lojas desativadas">
      <div className={styles.groupHeading}><h3><Archive size={13} />Lojas desativadas</h3><span>{disconnected.length}</span></div>
      <p className={styles.archiveNote}>Sem encomendas nas últimas 72 horas. O histórico mantém-se disponível para o período selecionado e está incluído nos totais acima.</p>
      <div className={styles.grid}>
        {disconnected.map((report, index) => <StoreCard key={report.storeId} report={report} index={index + active.length} currency={currency}
          store={byId.get(report.storeId)!} pendingGoogle={pendingStoreIds.includes(report.storeId)} />)}
      </div>
    </section>}
    <p className={styles.footnote}>Lucro após os custos registados.{personal ? " A tua participação aplica-se ao lucro e aos custos; receita, margem e encomendas referem-se à loja inteira." : " Os gráficos mostram os dias do período selecionado."} Abre uma loja para explorar os detalhes.</p>
  </section>;
}
