// Shared constants for the Store Research hub (safe for client + server).

export type StoreStatus =
  | "watching"
  | "interesting"
  | "winner"
  | "competitor"
  | "archived";

export const STORE_STATUSES: StoreStatus[] = [
  "watching",
  "interesting",
  "winner",
  "competitor",
  "archived",
];

export const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  watching: "A observar",
  interesting: "Interessante",
  winner: "Top Store",
  competitor: "Concorrente",
  archived: "Arquivada",
};

// Tailwind classes for the status pill (works in both themes).
export const STORE_STATUS_CLASS: Record<StoreStatus, string> = {
  watching: "bg-muted text-muted-foreground",
  interesting: "bg-sky-500/15 text-sky-400",
  winner: "bg-emerald-500/15 text-emerald-400",
  competitor: "bg-amber-500/15 text-amber-400",
  archived: "bg-muted/60 text-muted-foreground",
};
