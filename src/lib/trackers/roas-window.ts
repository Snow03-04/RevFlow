import { addDaysYmd, ymdInTz, zonedRangeUtc } from "@/lib/date";
import { calcRoas, roasDecision, type Decision, type PrevDayContext } from "./roas";

export type RoasWindowEntry = {
  campaign_key?: string | null; campaign_name: string; year: number; month: number; day: number;
  attribution_warning?: string | null;
  total_spend: number; cpc: number; atc: number; pur: number; price: number; cog: number; units_sold: number;
};
export type RoasScaleChange = { campaignKey: string; changedAt: string };
export type RoasEvaluation = {
  counter: number; from: string; to: string; scaledAt: string | null;
  decision: Decision; previous: Decision; historyKnown: boolean;
};
export const roasEntryDate = (r: RoasWindowEntry) => `${r.year}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}`;
const identity = (r: RoasWindowEntry) => r.campaign_key || `manual:${r.campaign_name.trim()}`;
const margin = (r: RoasWindowEntry) => calcRoas({ campaignName: r.campaign_name, totalSpend: Number(r.total_spend),
  cpc: Number(r.cpc), atc: Number(r.atc), pur: Number(r.pur), price: Number(r.price), cog: Number(r.cog), unitsSold: Number(r.units_sold) }).marginPct;

/** Calendar days close in the reporting timezone. A mid-day scale never mixes
 * the old budget's results into the new observation window. No month reset. */
export function evaluateRoasWindow(row: RoasWindowEntry, history: RoasWindowEntry[], changes: RoasScaleChange[],
  options: { date: string; today: string; timezone: string; historyKnown: boolean }): RoasEvaluation {
  const key = identity(row);
  const byDate = new Map<string, RoasWindowEntry>();
  const duplicates = new Set<string>();
  for (const r of history.filter((r) => identity(r) === key)) {
    const date = roasEntryDate(r);
    if (byDate.has(date)) duplicates.add(date);
    else byDate.set(date, r);
  }
  const evaluate = (date: string) => {
    const to = date >= options.today ? addDaysYmd(options.today, -1) : date;
    const from = addDaysYmd(to, -1);
    const end = zonedRangeUtc({ from: date, to: date }, options.timezone).endUtc;
    const scale = changes.filter((c) => c.campaignKey === row.campaign_key && c.changedAt < end)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
    const scaledAt = scale?.changedAt ?? null;
    let firstFullDay: string | null = null;
    if (scaledAt) {
      const local = ymdInTz(new Date(scaledAt), options.timezone);
      const midnight = zonedRangeUtc({ from: local, to: local }, options.timezone).startUtc;
      firstFullDay = Date.parse(scaledAt) === Date.parse(midnight) ? local : addDaysYmd(local, 1);
    }
    let counter = 0;
    for (let cursor = to; (!firstFullDay || cursor >= firstFullDay) && Number(byDate.get(cursor)?.total_spend ?? 0) > 0; cursor = addDaysYmd(cursor, -1)) counter++;
    const wait = (label: string): Decision => ({ kind: "window", label });
    let decision: Decision;
    if (date > options.today) decision = wait("Data futura — aguardar resultados");
    else if (row.campaign_key && !options.historyKnown) decision = wait("Orçamento por confirmar — atualiza a Meta");
    else if (row.attribution_warning || byDate.get(from)?.attribution_warning || byDate.get(to)?.attribution_warning)
      decision = wait("Vendas por confirmar — verifica a coleção");
    else if (firstFullDay && from < firstFullDay) decision = wait(`Escalada detetada — ${counter}/2 dias completos após o aumento`);
    else if (duplicates.has(from) || duplicates.has(to)) decision = wait("Campanha duplicada — confirma as linhas");
    else if (counter < 2) decision = wait(`Aguardar 2 dias completos com gasto (${Math.min(counter, 1)}/2)`);
    else {
      const current = byDate.get(to)!;
      const prev = byDate.get(from)!;
      const context: PrevDayContext = { active: Number(prev.total_spend) > 0, marginPct: margin(prev), counter: counter - 1 };
      decision = roasDecision(counter, Number(current.total_spend), margin(current), context);
    }
    return { counter, from, to, scaledAt, decision };
  };
  const current = evaluate(options.date);
  return { ...current, previous: evaluate(addDaysYmd(options.date, -1)).decision, historyKnown: options.historyKnown };
}
