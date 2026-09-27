export default function Loading() {
  return <div role="status" aria-label="A carregar o histórico financeiro" className="space-y-6"><div className="h-8 w-48 animate-pulse rounded bg-muted" /><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div><div className="h-80 animate-pulse rounded-xl bg-muted" /><span className="sr-only">A carregar todo o histórico disponível…</span></div>;
}
