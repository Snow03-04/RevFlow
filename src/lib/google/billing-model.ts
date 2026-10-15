export type BilledDay = { date: string; currency: string; served_cost: number; billed_cost: number };

/** Google exports localized CSV with two title lines. Reject ambiguous/partial
 * columns and duplicates instead of silently inventing zero billed costs. */
export function parseGoogleBilledCsv(text: string): BilledDay[] {
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field.trim()); field = "";
      if (c === '\n') { records.push(row); row = []; }
    } else if (c !== '\r') field += c;
  }
  if (quoted) throw new Error("CSV incompleto.");
  if (field || row.length) records.push([...row, field.trim()]);
  const normalize = (s: string) => s.replace(/^\uFEFF/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const headerIndex = records.findIndex(r => r.some(s => ["custo faturado", "billed cost"].includes(normalize(s))) && r.length > 2);
  if (headerIndex < 0) throw new Error("Exporta o relatório Custo faturado, com Nome do orçamento, Dia, Código da moeda, Custo de publicação e Custo faturado.");
  const header = records[headerIndex].map(normalize);
  const index = (names: string[]) => header.findIndex(h => names.includes(h));
  const name = index(["nome do orcamento", "budget name"]), date = index(["dia", "day"]), currency = index(["codigo da moeda", "currency code"]);
  const served = index(["custo de publicacao", "served cost"]), billed = index(["custo faturado", "billed cost"]);
  if ([name, date, currency, served, billed].includes(-1) || header.length !== 5) throw new Error("Usa apenas as cinco colunas do relatório Custo faturado.");
  const portuguese = header.includes("custo faturado");
  const amount = (s: string) => {
    if (s === "--" || s === "—") return 0;
    const normalized = portuguese ? s.replace(/[.\s\u00a0]/g, "").replace(",", ".") : s.replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("Custo inválido no CSV.");
    return Number(normalized);
  };
  const days = new Map<string, BilledDay>(), seen = new Set<string>();
  for (const r of records.slice(headerIndex + 1)) {
    if (r.every(v => !v)) continue;
    if (r.length !== header.length || !/^\d{4}-\d{2}-\d{2}$/.test(r[date]) || new Date(r[date] + "T00:00:00Z").toISOString().slice(0, 10) !== r[date]
      || !/^[A-Z]{3}$/.test(r[currency]) || !r[name]) throw new Error("Linha inválida: exporta o relatório sem totais nem filtros de campanhas.");
    const key = `${r[name]}:${r[date]}`;
    if (seen.has(key)) throw new Error("O relatório contém linhas repetidas ou nomes de orçamento ambíguos.");
    seen.add(key);
    const gross = amount(r[served]), net = amount(r[billed]);
    if (!Number.isFinite(gross + net) || net > gross) throw new Error("O custo faturado não pode ultrapassar o custo publicado.");
    if ((r[served] === "--") !== (r[billed] === "--")) throw new Error("O custo faturado ainda não está disponível para uma das linhas.");
    const day = days.get(r[date]) ?? { date: r[date], currency: r[currency], served_cost: 0, billed_cost: 0 };
    if (day.currency !== r[currency]) throw new Error("O relatório contém moedas diferentes no mesmo dia.");
    day.served_cost += gross; day.billed_cost += net; days.set(day.date, day);
  }
  if (!days.size) throw new Error("O relatório não contém custos diários.");
  return [...days.values()].map(d => ({ ...d, served_cost: Math.round(d.served_cost * 100) / 100, billed_cost: Math.round(d.billed_cost * 100) / 100 }));
}

/** Only a verified billing discount is removed. Later activity remains included
 * until reconciled. Promotions already funding all spend cannot become profit. */
export function billingDiscount(netExpense: number, served: number, billed: number, alreadyApplied = 0): number {
  return Math.max(0, Math.min(netExpense, served - billed - alreadyApplied));
}

export function reconciledBilledCost(net: number, gross: number | null, served: number, billed: number, alreadyApplied = 0): number {
  if (gross == null) return net - billingDiscount(net, served, billed, alreadyApplied);
  if (gross > 0 && net <= 0) return net; // A fully funded day stays fully funded.
  const promotionalCredit = Math.max(0, gross - net - alreadyApplied);
  // Billing may be ahead of the hourly import. Later activity is kept at served
  // cost until another billing report confirms its discount; never freeze today.
  return Math.max(0, Math.max(gross, net, served) - Math.max(served - billed, alreadyApplied) - promotionalCredit);
}
