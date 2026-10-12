/** Shared by the browser and the sync route; contains no server dependencies. */
export const AUTO_REFRESH_MS = 30_000;
export const REFRESH_RETRY_MS = 30_000;
export const REFRESH_TIMEOUT_MS = 310_000;
export const REFRESH_STREAM_TYPE = "application/x-ndjson";

export type RefreshResult = { ok: boolean; error?: string; synced?: boolean; completedAt?: string };
export type RefreshStep =
  | { kind: "shopify" | "meta" | "google" | "metrics"; id: string }
  | { kind: "pnl" | "roas" };
export type RefreshTask = { step: RefreshStep; label: string };
export type RefreshPlan = RefreshResult & { stages?: {
  kind: "imports" | "totals" | "reports";
  tasks: RefreshTask[];
}[] };
export type RefreshEvent =
  | { type: "progress"; message: string }
  | { type: "heartbeat" }
  | { type: "result"; result: RefreshResult };
