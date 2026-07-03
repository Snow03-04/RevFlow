// Shared constants for the Product Research hub (safe for client + server).

export type ProductStatus =
  | "untested"
  | "testing"
  | "winner"
  | "loser"
  | "scaling"
  | "archived";

export const STATUSES: ProductStatus[] = [
  "untested",
  "testing",
  "winner",
  "loser",
  "scaling",
  "archived",
];

export const STATUS_LABEL: Record<ProductStatus, string> = {
  untested: "Não testado",
  testing: "Em teste",
  winner: "Vencedor",
  loser: "Perdedor",
  scaling: "Escalar",
  archived: "Arquivado",
};

// Tailwind classes for the status pill (works in both themes).
export const STATUS_CLASS: Record<ProductStatus, string> = {
  untested: "bg-muted text-muted-foreground",
  testing: "bg-sky-500/15 text-sky-400",
  winner: "bg-emerald-500/15 text-emerald-400",
  loser: "bg-red-500/15 text-red-400",
  scaling: "bg-primary/15 text-primary",
  archived: "bg-muted/60 text-muted-foreground",
};

export function statusLabel(s: string): string {
  return STATUS_LABEL[s as ProductStatus] ?? s;
}
