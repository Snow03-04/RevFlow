export const PLANS = [
  { id: "monthly", name: "Mensal", months: 1, amount: 695, price: "6,95", period: "mês", equivalent: "6,95", saving: null },
  { id: "quarterly", name: "Trimestral", months: 3, amount: 1495, price: "14,95", period: "3 meses", equivalent: "4,98", saving: "Poupa 28%" },
  { id: "yearly", name: "Anual", months: 12, amount: 4495, price: "44,95", period: "ano", equivalent: "3,75", saving: "Poupa 46%" },
] as const;
export type PlanId = (typeof PLANS)[number]["id"];
export function findPlan(id: unknown) { return PLANS.find(plan => plan.id === id); }
export function planSignupUrl(id: PlanId) { return `/signup?redirectTo=${encodeURIComponent(`/subscribe?plan=${id}`)}`; }
