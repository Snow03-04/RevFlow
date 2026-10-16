"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Download, Loader2, ChevronDown, Search, X, Info, ArrowUpRight, Clock3, AlertTriangle, MoreHorizontal } from "lucide-react";
import type { Tables } from "@/types/database";
import {
  calcRoas,
  budgetRecommendation,
  roasBand,
  convBand,
  type Decision,
  type RoasThresholds,
} from "@/lib/trackers/roas";
import { formatRoasScaleDate, type RoasEvaluation } from "@/lib/trackers/roas-window";
import { money, pct, mult, bandText, bandBg } from "@/lib/trackers/format";
import {
  saveRoasEntry,
  deleteRoasEntry,
  autofillRoasDay,
  autofillRoasAllDays,
  clearAllRoasEntries,
} from "@/lib/trackers/actions";
import { useDebouncedSave } from "@/components/trackers/cells";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  position: number;
  name: string;
  spend: number;
  cpc: number;
  atc: number;
  pur: number;
  price: number;
  cog: number;
  units: number;
  attributionWarning?: string | null;
}

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const columns = "lg:grid-cols-[minmax(150px,2fr)_repeat(4,minmax(70px,.8fr))_minmax(140px,1.2fr)_16px]";
const fieldClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary sm:text-sm";
const shortDate = (date: string) => date.split("-").reverse().join("/");
const decisionTitles: Record<Decision["kind"], string> = {
  scale: "Escalar", maintain: "Manter", kill: "Reduzir / parar", monitor: "Monitorizar",
  window: "A aguardar", new: "Em observação", empty: "Sem decisão", none: "Sem decisão",
};

function decisionTitle(decision: Decision) {
  return decision.kind === "window" && /por confirmar|duplicada/.test(decision.label)
    ? "Verificar dados" : decisionTitles[decision.kind];
}

function decisionHint(decision: Decision, counter: number) {
  if (decision.kind === "scale") return "Verifica o dia da semana";
  if (decision.kind === "maintain") return "Critérios de escala não atingidos";
  if (decision.kind === "kill") return "Margem média negativa";
  if (decision.kind === "monitor") return "Em recuperação · rever em 24h";
  if (decision.kind === "window") {
    if (/Vendas por confirmar/.test(decision.label)) return "Vendas da coleção por confirmar";
    if (/Orçamento por confirmar/.test(decision.label)) return "Atualiza os dados da Meta";
    if (/duplicada/.test(decision.label)) return "Confirma as linhas duplicadas";
    if (/futura/.test(decision.label)) return "Ainda sem resultados";
    return `${Math.min(counter, 2)}/2 dias completos${/Escalada/.test(decision.label) ? " após escala" : " com gasto"}`;
  }
  return decision.kind === "new" ? "A recolher resultados" : "";
}

function NumericField({ label, value, onChange, step = "0.01" }: {
  label: string; value: number; onChange: (value: number) => void; step?: string;
}) {
  return <label className="block space-y-1.5 text-xs text-muted-foreground">
    <span>{label}</span>
    <input type="number" step={step} inputMode={step === "1" ? "numeric" : "decimal"}
      value={Number.isFinite(value) ? value : ""} onFocus={(event) => event.target.select()}
      onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))}
      className={cn(fieldClass, "tabular-nums text-foreground")} />
  </label>;
}

export function RoasGrid({
  year,
  month,
  day,
  initialEntries,
  evaluations,
  timezone,
  thresholds,
  minMargin,
  currency,
}: {
  year: number;
  month: number;
  day: number;
  initialEntries: Tables<"roas_entries">[];
  evaluations: Record<string, RoasEvaluation>;
  timezone: string;
  thresholds: RoasThresholds;
  minMargin: number;
  currency: string;
}) {
  const debounce = useDebouncedSave();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>(() =>
    initialEntries.map((e) => ({
      id: e.id,
      position: e.position,
      name: e.campaign_name,
      spend: Number(e.total_spend),
      cpc: Number(e.cpc),
      atc: Number(e.atc),
      pur: Number(e.pur),
      price: Number(e.price),
      cog: Number(e.cog),
      units: Number(e.units_sold),
      attributionWarning: e.attribution_warning,
    })),
  );

  function persist(r: Row) {
    debounce(`row-${r.id}`, () =>
      saveRoasEntry({
        id: r.id,
        year,
        month,
        day,
        position: r.position,
        campaign_name: r.name,
        total_spend: r.spend,
        cpc: r.cpc,
        atc: r.atc,
        pur: r.pur,
        price: r.price,
        cog: r.cog,
        units_sold: r.units,
      }),
    );
  }

  function update(id: string, patch: Partial<Row>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const changed = next.find((r) => r.id === id);
      if (changed) persist(changed);
      return next;
    });
  }

  function addRow() {
    const r: Row = {
      id: newId(),
      position: rows.length,
      name: "",
      spend: 0,
      cpc: 0,
      atc: 0,
      pur: 0,
      price: 0,
      cog: 0,
      units: 0,
    };
    setRows((prev) => [...prev, r]);
    setSearch("");
    setExpandedId(r.id);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    deleteRoasEntry(id);
  }

  const [importing, startImport] = useTransition();
  function runImport() {
    if (
      !confirm(
        `Importar campanhas da Meta para ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}? Sincroniza a Meta ao vivo e preenche Campaign / Spend / CPC / PUR e o COG (da página Custos).`,
      )
    )
      return;
    startImport(async () => {
      const res = await autofillRoasDay(year, month, day);
      if (!res.ok) alert(res.error ?? "Falha ao importar.");
      else if ((res.count ?? 0) === 0)
        alert("Sem campanhas Meta sincronizadas para esse dia.");
      else window.location.reload();
    });
  }

  const [importingAll, startImportAll] = useTransition();
  function runImportAll() {
    if (
      !confirm(
        `Importar as campanhas da Meta para TODOS os dias de ${String(month).padStart(2, "0")}/${year}? Sincroniza a Meta ao vivo e coloca cada campanha no seu dia, com o COG da página Custos.`,
      )
    )
      return;
    startImportAll(async () => {
      const res = await autofillRoasAllDays(year, month);
      if (!res.ok) alert(res.error ?? "Falha ao importar.");
      else if ((res.count ?? 0) === 0)
        alert("Sem campanhas Meta sincronizadas neste mês.");
      else window.location.reload();
    });
  }

  const [clearing, startClear] = useTransition();
  function runClear() {
    if (
      !confirm(
        "Apagar TODAS as campanhas de TODOS os dias do ROAS Tracker? Esta ação não pode ser desfeita.",
      )
    )
      return;
    startClear(async () => {
      const res = await clearAllRoasEntries();
      if (!res.ok) alert(res.error ?? "Falha ao limpar.");
      else window.location.reload();
    });
  }

  // Duplicate-name detection within this day.
  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.name.trim();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const C = currency;
  const visibleRows = rows.filter((row) => row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const calculated = visibleRows.map((row) => ({
    row,
    calc: calcRoas({ campaignName: row.name, totalSpend: row.spend, cpc: row.cpc, atc: row.atc,
      pur: row.pur, price: row.price, cog: row.cog, unitsSold: row.units }),
  }));
  const totals = calculated.reduce((sum, { row, calc }) => ({
    spend: sum.spend + row.spend, revenue: sum.revenue + calc.storeValue,
    margin: sum.margin + calc.netMargin, units: sum.units + row.units,
  }), { spend: 0, revenue: 0, margin: 0, units: 0 });
  const warningCount = visibleRows.filter((row) => row.attributionWarning).length;

  function marginCls(value: number, percent: number | null): string {
    if (value < 0) return "text-red-600 dark:text-red-400";
    if (percent !== null && percent >= minMargin) return "text-emerald-600 dark:text-emerald-400";
    return "text-foreground";
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Gasto em anúncios", value: money(totals.spend, C), note: "Campanhas apresentadas" },
          { label: "Vendas atribuídas", value: money(totals.revenue, C), note: totals.units + " unidades vendidas" },
          { label: "Margem do tracker", value: money(totals.margin, C), note: "Vendas − COGS − anúncios",
            color: marginCls(totals.margin, totals.revenue ? totals.margin / totals.revenue : null) },
          { label: "ROAS", value: mult(totals.spend ? totals.revenue / totals.spend : null), note: "Vendas / gasto em anúncios" },
        ].map((stat) => (
          <div key={stat.label} className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-5">
            <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
            <p className={cn("mt-2 break-words text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", stat.color)}>{stat.value}</p>
            <p className="mt-1.5 hidden text-[11px] text-muted-foreground sm:block">{stat.note}</p>
          </div>
        ))}
      </div>

      {warningCount > 0 && <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{warningCount === 1 ? "1 campanha com vendas por confirmar." : warningCount + " campanhas com vendas por confirmar."} Totais incluem valores anteriores.<span className="hidden sm:inline"> Abre os detalhes da campanha para ver o motivo.</span></span>
      </div>}

      <section aria-label="Campanhas do dia" className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            Campanhas <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">{visibleRows.length}</span>
          </h3>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input aria-label="Pesquisar campanhas" placeholder="Pesquisar campanha…" value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-base outline-none focus:border-primary focus:ring-1 focus:ring-primary sm:text-sm" />
              {search && <button aria-label="Limpar pesquisa" onClick={() => setSearch("")} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <Button variant="outline" size="sm" onClick={addRow} className="h-10 shrink-0" aria-label="Adicionar campanha">
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">Adicionar</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Mais ações do tracker" disabled={importing || importingAll || clearing}>
                  {importing || importingAll || clearing ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={runImport}><Download />Importar este dia</DropdownMenuItem>
                <DropdownMenuItem onSelect={runImportAll}><Download />Importar mês inteiro</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={runClear} className="text-destructive focus:text-destructive"><Trash2 />Limpar todos os dias</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div aria-hidden="true" className={cn("hidden items-center gap-x-3 border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-medium text-muted-foreground lg:grid", columns)}>
          <span>Campanha</span><span className="text-right">Gasto</span><span className="text-right">Vendas</span>
          <span className="text-right">ROAS</span><span className="text-right">Margem</span><span>Sugestão · 2 dias</span><span />
        </div>

        <div className="divide-y divide-border/70">
          {calculated.map(({ row: r, calc }) => {
            const evaluation = evaluations[r.id];
            const counter = evaluation?.counter ?? 0;
            const decision = evaluation?.decision ?? { label: "Aguardar 2 dias completos", kind: "window" as const };
            const budgetRec = budgetRecommendation(decision.kind, r.spend);
            const duplicate = (nameCounts.get(r.name.trim()) ?? 0) > 1;
            const expanded = expandedId === r.id;
            const name = r.name || "Nova campanha";
            const decisionColor = decision.kind === "scale" ? "text-emerald-700 dark:text-emerald-400"
              : decision.kind === "kill" ? "text-red-700 dark:text-red-400"
              : decision.kind === "maintain" || decision.kind === "monitor" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground";

            return (
              <article key={r.id} className={cn("transition-colors", expanded && "bg-muted/15")}>
                <button type="button" aria-expanded={expanded} aria-controls={"campaign-" + r.id}
                  aria-label={(expanded ? "Fechar" : "Ver") + " detalhes de " + name}
                  aria-describedby={["Gasto", "Vendas", "ROAS", "Margem", "decision"].map((key) => "metric-" + r.id + "-" + key).join(" ")}
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                  className={cn("relative grid w-full grid-cols-2 items-center gap-x-3 gap-y-4 p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-4 sm:px-5 lg:py-5", columns)}>
                  <span className="col-span-2 min-w-0 pr-6 sm:col-span-4 lg:col-span-1 lg:pr-0">
                    <span className="block break-words text-sm font-medium leading-relaxed">{name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {evaluation?.scaledAt
                        ? <span className="inline-flex items-center gap-1"><ArrowUpRight className="h-3 w-3" />Escalada {formatRoasScaleDate(evaluation.scaledAt, timezone)}</span>
                        : <span>{r.units} {r.units === 1 ? "unidade" : "unidades"} · {r.pur} {r.pur === 1 ? "compra Meta" : "compras Meta"}</span>}
                      {(r.attributionWarning || duplicate) && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3 w-3" />{r.attributionWarning ? "Vendas por confirmar" : "Nome repetido"}</span>}
                    </span>
                  </span>
                  {[
                    { label: "Gasto", value: money(r.spend, C) },
                    { label: "Vendas", value: money(calc.storeValue, C) },
                    { label: "ROAS", value: mult(calc.roas), color: bandText[roasBand(calc.roas, thresholds)] },
                    { label: "Margem", value: money(calc.netMargin, C), color: marginCls(calc.netMargin, calc.marginPct), sub: pct(calc.marginPct) },
                  ].map((metric) => <span key={metric.label} id={"metric-" + r.id + "-" + metric.label} className="min-w-0 lg:text-right">
                    <span className="mb-1 block text-[11px] text-muted-foreground lg:sr-only">{metric.label}</span>
                    <span className={cn("block text-sm font-medium tabular-nums", metric.color)}>{metric.value}</span>
                    {metric.sub && <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">{metric.sub}</span>}
                  </span>)}
                  <span id={"metric-" + r.id + "-decision"} className="col-span-2 min-w-0 border-t border-border/60 pt-3 sm:col-span-4 lg:col-span-1 lg:border-0 lg:pt-0">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium", decisionColor, bandBg[decision.kind])}>
                      {decision.kind === "scale" ? <ArrowUpRight className="h-3.5 w-3.5" /> : decision.kind === "window" ? <Clock3 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                      {decisionTitle(decision)}{budgetRec && <span className="ml-0.5">{budgetRec}</span>}
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground">{decisionHint(decision, counter)}</span>
                  </span>
                  <ChevronDown className={cn("absolute right-4 top-5 h-4 w-4 text-muted-foreground transition-transform sm:right-5 lg:static", expanded && "rotate-180")} />
                </button>

                {expanded && <div id={"campaign-" + r.id} className="border-t border-border/60 p-4 sm:p-5">
                  <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
                    <section className="min-w-0 space-y-4" aria-label={"Dados de " + name}>
                      <div>
                        <h4 className="text-sm font-medium">Dados da campanha</h4>
                        <p className="mt-1 text-xs text-muted-foreground">Os campos são guardados automaticamente.</p>
                      </div>
                      <label className="block space-y-1.5 text-xs text-muted-foreground">
                        <span>Nome da campanha</span>
                        <input autoFocus={!r.name} value={r.name} onChange={(event) => update(r.id, { name: event.target.value })} placeholder="Nome exato da campanha" className={cn(fieldClass, "text-foreground")} />
                      </label>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <NumericField label={"Gasto (" + C + ")"} value={r.spend} onChange={(spend) => update(r.id, { spend })} />
                        <NumericField label={"CPC (" + C + ")"} value={r.cpc} onChange={(cpc) => update(r.id, { cpc })} />
                        <NumericField label="Adições ao carrinho" value={r.atc} step="1" onChange={(atc) => update(r.id, { atc })} />
                        <NumericField label="Compras Meta" value={r.pur} step="1" onChange={(pur) => update(r.id, { pur })} />
                        <NumericField label={"Preço médio (" + C + ")"} value={r.price} onChange={(price) => update(r.id, { price })} />
                        <NumericField label={"COG por unidade (" + C + ")"} value={r.cog} onChange={(cog) => update(r.id, { cog })} />
                        <NumericField label="Unidades vendidas" value={r.units} step="1" onChange={(units) => update(r.id, { units })} />
                      </div>
                      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg border border-border bg-background/50 p-3 text-xs sm:grid-cols-3">
                        {[
                          ["COGS total", money(calc.totalCog, C)], ["Margem / unidade", money(calc.marginPerUnit, C)],
                          ["CPA", money(calc.cpa, C)], ["ROAS de equilíbrio", mult(calc.ber)],
                          ["Conversão ATC → compra", pct(calc.convPct)],
                        ].map(([label, value]) => <div key={label}>
                          <dt className="text-muted-foreground">{label}</dt><dd className={cn("mt-1 font-medium tabular-nums", label === "Conversão ATC → compra" && bandText[convBand(calc.convPct)])}>{value}</dd>
                        </div>)}
                      </dl>
                    </section>

                    <section className="min-w-0 space-y-4 text-sm" aria-label={"Avaliação de " + name}>
                      <div className="rounded-xl border border-border bg-background/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className={cn("font-medium", decisionColor)}>{decisionTitle(decision)}{budgetRec && " · " + budgetRec}</h4>
                          <span className="text-xs text-muted-foreground">Sugestão</span>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{decision.label || "Sem gasto para avaliar."}</p>
                        {evaluation && counter >= 2 && evaluation.historyKnown && <p className="mt-3 text-xs text-muted-foreground">Dias avaliados: <span className="text-foreground">{shortDate(evaluation.from)} a {shortDate(evaluation.to)}</span></p>}
                        {evaluation?.scaledAt && <p className="mt-2 text-xs text-muted-foreground">Última escala: <span className="text-foreground">{formatRoasScaleDate(evaluation.scaledAt, timezone)}</span></p>}
                        {evaluation && <div className="mt-4 border-t border-border pt-3">
                          <p className="text-[11px] font-medium text-muted-foreground">Janela anterior</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{evaluation.previous.label || "Sem decisão anterior."}</p>
                        </div>}
                      </div>
                      {(r.attributionWarning || duplicate) && <div className="flex items-start gap-2 rounded-lg bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" /><div>
                          {r.attributionWarning && <p>{r.attributionWarning}</p>}
                          {duplicate && <p>Há outra campanha com este nome neste dia. Confirma que são campanhas diferentes.</p>}
                        </div>
                      </div>}
                      <p className="text-xs leading-relaxed text-muted-foreground">A avaliação reinicia após uma escala. Sem novo aumento, usa sempre os últimos 2 dias completos.</p>
                      <Button variant="ghost" size="sm" onClick={() => removeRow(r.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />Remover campanha deste dia
                      </Button>
                    </section>
                  </div>
                </div>}
              </article>
            );
          })}
        </div>

        {!visibleRows.length && <div className="px-5 py-14 text-center">
          <Search className="mx-auto mb-3 h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">{search ? "Nenhuma campanha encontrada" : "Ainda sem campanhas neste dia"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{search ? "Experimenta outro nome ou limpa a pesquisa." : "Importa as campanhas da Meta ou adiciona uma campanha."}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={search ? () => setSearch("") : runImport} disabled={importing}>
            {search ? "Limpar pesquisa" : importing ? "A importar…" : "Importar este dia"}
          </Button>
        </div>}
      </section>

      <details className="group rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <summary className="flex min-h-6 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <Info className="h-3.5 w-3.5" /><span>Como são calculadas as vendas e sugestões</span><ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 max-w-3xl space-y-2 border-t border-border pt-3 leading-relaxed">
          <p>As coleções incluem entradas na coleção e nos seus produtos. O identificador da campanha tem prioridade; sem ele, a atribuição é estimada e repartida entre campanhas elegíveis. As vendas de Google Ads são excluídas.</p>
          <p>Os números apresentados são do dia selecionado. As sugestões usam os últimos 2 dias completos e reiniciam após um aumento de orçamento. Abre uma campanha para consultar a janela e o motivo da sugestão.</p>
          <p>A margem do tracker desconta COGS e anúncios; não é o lucro final da P&amp;L. As decisões são sugestões e não são aplicadas automaticamente às campanhas.</p>
        </div>
      </details>
    </div>
  );
}
