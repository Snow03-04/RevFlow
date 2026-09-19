// Thresholds use the dashboard's display currency. Celebrations are daily only.
export const PROFIT_MILESTONES = [100, 200, 300, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000] as const;
const NAMES = ["Primeiro marco", "A ganhar ritmo", "Em crescimento", "A acelerar", "Quatro dígitos", "Novo patamar", "Grande resultado", "Cinco dígitos", "Em grande escala", "Extraordinário", "Seis dígitos"];

export function profitMilestone(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  const level = PROFIT_MILESTONES.filter((threshold) => amount >= threshold).length;
  const reached = level > 0 ? PROFIT_MILESTONES[level - 1] : 0;
  const next = PROFIT_MILESTONES[level] ?? null;
  return {
    level,
    reached,
    next,
    style: amount >= 1000 ? "champagne" : amount >= 500 ? "gold" : amount >= 200 ? "violet" : amount >= 100 ? "rising" : "base",
    label: amount < 0 ? "A recuperar" : level === 0 ? "Rumo ao primeiro marco" : NAMES[level - 1],
    progress: next === null ? 1 : Math.max(0, Math.min(1, (amount - reached) / (next - reached))),
  };
}
