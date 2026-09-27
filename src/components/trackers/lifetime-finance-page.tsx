import Link from "next/link";
import { ArrowUpRight, Clock3, History, Store } from "lucide-react";
import type { getLifetimeData } from "@/lib/trackers/lifetime-query";
import type { LifetimeTotals } from "@/lib/trackers/lifetime";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LifetimeHistoryEditor } from "./lifetime-history-editor";

type Data = Awaited<ReturnType<typeof getLifetimeData>>;
const dateLabel = (date: string | null) => date ? date.split("-").reverse().join("/") : "—";
const ratio = (value: number | null, suffix: string, factor = 1) => value == null ? "—" : `${(value * factor).toLocaleString("pt-PT", { maximumFractionDigits: suffix === "%" ? 1 : 2 })}${suffix}`;
function previousDay(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function LifetimeFinancePage({ data, filtered }: { data: Data; filtered: boolean }) {
  const { rows, total, stores, currency } = data;
  const money = (amount: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  const count = (amount: number) => amount.toLocaleString("pt-PT");
  const unresolved = rows.filter((row) => !row.confirmed && row.firstDate);
  const hasData = !!total.firstDate;
  const value = (amount: number) => hasData ? money(amount) : "—";
  const profitColor = (profit: number) => profit < 0 ? "text-red-400" : profit > 0 ? "text-emerald-400" : "text-foreground";
  const cards = [
    { label: "Faturação", value: value(total.revenue), color: "text-primary", note: "Antes de reembolsos · inclui portes" },
    { label: "Lucro", value: value(total.profit), color: profitColor(total.profit), note: total.googleEstimate ? "Provisório · inclui gastos por confirmar" : "Após custos e taxas da P&L" },
    { label: "Margem de lucro", value: ratio(total.margin, "%", 100), note: "Sobre a faturação líquida" },
    { label: "ROAS", value: ratio(total.roas, "×"), note: "Faturação líquida / anúncios" },
    { label: "Ad spend", value: value(total.adSpend), note: "Meta + Google" },
    { label: "Comissões de agência", value: value(total.agencyFee), note: "Taxas configuradas na P&L" },
    { label: "Taxas de pagamento", value: value(total.paymentFee), note: "Percentagem + valor por encomenda" },
    { label: "Encomendas", value: hasData ? count(total.orders) : "—", note: hasData ? `${count(total.units)} produtos vendidos` : "Ainda sem dados calculados" },
  ];
  function cells(row: LifetimeTotals) {
    const available = !!row.firstDate;
    return <>{(["revenue", "refunds", "cogs", "adSpend", "agencyFee", "paymentFee", "profit"] as const).map((field) => <TableCell key={field} className={cn("whitespace-nowrap text-right text-xs tabular-nums", field === "profit" && profitColor(row.profit), field === "revenue" && "font-medium")}>
      {available ? money(row[field]) : "—"}{field === "adSpend" && row.googleEstimate > 0 && <span className="block text-[10px] text-amber-400">Inclui {money(row.googleEstimate)} por confirmar</span>}
    </TableCell>)}<TableCell className="text-right text-xs tabular-nums">{ratio(row.margin, "%", 100)}</TableCell><TableCell className="text-right text-xs tabular-nums">{available ? count(row.orders) : "—"}</TableCell></>;
  }
  return <div className="mx-auto max-w-[1600px] space-y-8">
    <PageHeader title="Desde Sempre" description="O percurso de todas as tuas lojas, marca a marca." actions={<a href="#historico" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs hover:bg-accent"><History className="h-4 w-4" />Gerir histórico</a>} />
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-sm font-semibold">{filtered ? "Histórico do Shopify selecionado" : "Todas as lojas juntas"}</h2><p className="mt-1 text-xs text-muted-foreground">{hasData ? `Dados calculados de ${dateLabel(total.firstDate)} a ${dateLabel(total.lastDate)} · ${currency}` : "Os totais aparecem quando existirem dados calculados."}</p></div><span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" /> Todo o histórico disponível</span></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map((card) => <Card key={card.label} className="min-w-0 p-4 sm:p-5"><p className="text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">{card.label}</p><p className={cn("mt-2 break-words text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", card.color)}>{card.value}</p><p className="mt-1.5 text-[10px] text-muted-foreground">{card.note}</p></Card>)}</div>
    </section>
    {unresolved.length > 0 && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4"><p className="max-w-3xl text-xs leading-relaxed text-muted-foreground"><strong className="text-amber-400">Histórico por confirmar.</strong> Existem dados de {unresolved.length} Shopify(s) ainda por atribuir a uma marca. Entram no total global e aparecem separados na tabela até configurares o histórico.</p><a href="#historico" className="whitespace-nowrap text-xs font-medium text-amber-400">Definir marcas e datas →</a></div>}
    {data.unassignedDays > 0 && <p role="status" className="rounded-lg border border-amber-500/25 p-4 text-xs text-amber-400">Existem {data.unassignedDays} registos diários sem uma loja disponível. Estão excluídos destes totais; é necessário recuperar a associação à loja.</p>}
    {data.invalidStore && <p role="status" className="text-sm text-muted-foreground">Esta loja não está disponível nesta conta. <Link href="/finance/desde-sempre" className="text-primary">Ver todas as lojas</Link></p>}
    <section className="space-y-4"><div><h2 className="text-base font-semibold">Por loja</h2><p className="mt-1 text-xs text-muted-foreground">Cada marca no seu período. Totais em {currency}.</p></div>
      <Card className="overflow-hidden"><Table><TableHeader><TableRow className="bg-muted/30">{["Loja / marca", "Dados desde", "Faturação", "Reembolsos", "Custo de produtos", "Ad spend", "Agência", "Pagamento", "Lucro", "Margem", "Enc."].map((label, index) => <TableHead key={label} className={cn("whitespace-nowrap text-[10px] uppercase tracking-wider", index > 1 && "text-right")}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>
        {rows.map((row) => <TableRow key={row.key}><TableCell className="min-w-[210px]"><p className="text-xs font-medium">{row.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{row.from ? dateLabel(row.from) : "Início do histórico"} → {row.to ? dateLabel(previousDay(row.to)) : "atual"}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{row.domain}</p></TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.firstDate ? dateLabel(row.firstDate) : "Sem dados"}</TableCell>{cells(row)}</TableRow>)}
        {!rows.length && <TableRow><TableCell colSpan={11} className="h-32 text-center text-sm text-muted-foreground"><Store className="mx-auto mb-2 h-5 w-5" />Ainda sem lojas disponíveis. <Link href="/connections" className="text-primary">Ligar uma loja</Link></TableCell></TableRow>}
        {rows.length > 0 && <TableRow className="border-t-2 border-border bg-muted/30 font-semibold"><TableCell className="text-xs">{filtered ? "Total selecionado" : "Global"}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(total.firstDate)}</TableCell>{cells(total)}</TableRow>}
      </TableBody></Table></Card>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{total.googleEstimate > 0 && "O lucro inclui estimativas Google ainda por confirmar. "}Totais somados antes do arredondamento. Margem e ROAS são calculados sobre o total, não pela média das lojas.</p>
    </section>
    {stores.length > 0 && <LifetimeHistoryEditor stores={stores} histories={data.histories} />}
    <details className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Como são calculados estes valores</summary><div className="mt-4 max-w-4xl space-y-3 leading-relaxed">
      <p>Lucro = faturação − reembolsos − custo dos produtos − anúncios − comissões de agência − taxas de pagamento. Usa os mesmos dados diários e pressupostos da P&amp;L, incluindo as comissões definidas por mês e ano. As taxas de pagamento são estimadas pelas definições da P&amp;L.</p>
      <p>Inclui todos os anos disponíveis até hoje, no fuso {data.timezone}. “Dados desde” indica o primeiro registo diário calculado, não a data de abertura da loja nem uma garantia de importação completa. Dados ainda não importados, intervalos em falta e lojas cujos registos foram apagados não podem ser recuperados nesta vista.</p>
      <p>A mudança de marca distribui os dados pelo dia, incluindo os anúncios já associados ao Shopify. Reembolsos ficam no dia da encomenda original. Uma conta de anúncios que passou entre Shopifys diferentes precisa da associação correta dos dados; mudar o nome da marca não corrige essa associação.</p>
      <p>As moedas usam a conversão atual/configurada no RevFlow, tal como a P&amp;L; não são câmbios históricos diários. Se o Shopify mudou também de moeda, os valores antigos precisam de reconciliação. Ajustes manuais na folha global, custos fixos e despesas fora da P&amp;L não estão distribuídos por marca nesta página.</p>
      <Link href="/pnl?view=settings" className="inline-flex items-center gap-1 text-primary">Ver comissões e taxas <ArrowUpRight className="h-3 w-3" /></Link>
    </div></details>
  </div>;
}
