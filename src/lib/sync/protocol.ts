/** Shared by the browser and the sync route; contains no server dependencies. */
// Keep manual refresh immediate; idle tabs must not re-read the financial
// history twice a minute. Hidden/offline tabs already suspend this timer.
export const AUTO_REFRESH_MS = 5 * 60_000;
export const REFRESH_RETRY_MS = 30_000;
export const REFRESH_TIMEOUT_MS = 120_000;
export const REFRESH_STEP_TIMEOUT_MS = 45_000;
export const REFRESH_STREAM_TYPE = "application/x-ndjson";

export type RefreshResult = { ok: boolean; error?: string; synced?: boolean; completedAt?: string };
export type RefreshStep =
  | { kind: "shopify" | "shopify-sales" | "payments" | "meta" | "google" | "metrics"; id: string }
  | { kind: "pnl" | "roas" };
export type RefreshTask = { step: RefreshStep; label: string };
export type RefreshPlan = RefreshResult & { stages?: {
  kind: "imports" | "totals" | "reports" | "publish" | "reconcile";
  tasks: RefreshTask[];
}[] };
export type RefreshEvent =
  | { type: "progress"; message: string }
  | { type: "heartbeat" }
  | { type: "result"; result: RefreshResult };
