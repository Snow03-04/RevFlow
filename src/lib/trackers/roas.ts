/**
 * Tracker 2 — Daily ROAS Campaign Tracker calculations + 48h decision engine.
 * All decisions are SUGGESTIONS, not financial advice.
 */

export interface RoasInput {
  campaignName: string; // A
  totalSpend: number; // B
  cpc: number; // C
  atc: number; // D
  pur: number; // E
  price: number; // I
  cog: number; // J
  unitsSold: number; // L
}

export interface RoasCalc {
  ber: number | null; // F = price / marginPerUnit
  roas: number | null; // G = storeValue / spend
  cpa: number | null; // H = spend / pur
  marginPerUnit: number; // K = price - cog
  totalCog: number; // M = cog * units
  storeValue: number; // N = price * units
  netMargin: number; // O = N - M - spend
  marginPct: number | null; // P = O / N
  convPct: number | null; // R = pur / atc
}

export function calcRoas(i: RoasInput): RoasCalc {
  const marginPerUnit = i.price - i.cog;
  const totalCog = i.cog * i.unitsSold;
  const storeValue = i.price * i.unitsSold;
  const netMargin = storeValue - totalCog - i.totalSpend;
  return {
    marginPerUnit,
    totalCog,
    storeValue,
    netMargin,
    ber: marginPerUnit === 0 ? null : i.price / marginPerUnit,
    roas: i.totalSpend === 0 ? null : storeValue / i.totalSpend,
    cpa: i.pur === 0 ? null : i.totalSpend / i.pur,
    marginPct: storeValue === 0 ? null : netMargin / storeValue,
    convPct: i.atc === 0 ? null : i.pur / i.atc,
  };
}

/** ROAS colour band from the configurable thresholds. */
export interface RoasThresholds {
  scale: number; // ≥ → green
  maintain: number; // ≥ → amber
  watch: number; // ≥ → purple
}

export function roasBand(
  roas: number | null,
  t: RoasThresholds,
): "scale" | "maintain" | "watch" | "bad" | "none" {
  if (roas === null) return "none";
  if (roas >= t.scale) return "scale";
  if (roas >= t.maintain) return "maintain";
  if (roas >= t.watch) return "watch";
  return "bad";
}

/** ATC→PUR conversion colour: red <10%, amber 10–30%, green >30%. */
export function convBand(convPct: number | null): "good" | "warn" | "bad" | "none" {
  if (convPct === null) return "none";
  if (convPct > 0.3) return "good";
  if (convPct >= 0.1) return "warn";
  return "bad";
}

/* ------------------------------------------------------------------ */
/* 48h paired-window decision engine                                   */
/* ------------------------------------------------------------------ */

export type DecisionKind =
  | "empty"
  | "new"
  | "window"
  | "monitor"
  | "kill"
  | "scale"
  | "maintain";

export interface Decision {
  label: string;
  kind: DecisionKind;
}

/** Context about the same campaign on the *previous* day. */
export interface PrevDayContext {
  active: boolean; // existed yesterday with spend > 0
  marginPct: number | null; // m1
  counter: number; // Day# yesterday
}

/**
 * Day# counter: consecutive active days. Resets to 0 when a campaign has no
 * spend (or no name); otherwise yesterday's counter + 1.
 */
export function dayCounter(
  name: string,
  spend: number,
  prevCounter: number,
): number {
  if (!name.trim() || spend === 0) return 0;
  return prevCounter + 1;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * The decision for the current day, evaluated in the exact priority order of
 * the spec. Even Day# counters trigger evaluation; odd (>1) are observation.
 */
export function roasDecision(
  counter: number,
  spend: number,
  marginPct: number | null,
  prev: PrevDayContext,
): Decision {
  if (spend === 0) return { label: "", kind: "empty" };
  if (counter === 1)
    return { label: "🆕 New Campaign — Day 1", kind: "new" };
  if (counter % 2 === 1)
    return { label: `⏸ New Window — Day ${counter}`, kind: "window" };

  // Even Day# ≥ 2 → evaluate the 48h window. Null margin counts as negative.
  const m1 = prev.marginPct === null ? -1 : prev.marginPct;
  const m2 = marginPct === null ? -1 : marginPct;

  if (m1 < 0 && m2 >= 0.1) {
    return {
      label: "⏳ MONITOR 24h — D1 negativo mas a recuperar",
      kind: "monitor",
    };
  }

  const avg = (m1 + m2) / 2;
  if (avg < 0) {
    return { label: "🔴 KILL / DESCALE — média 48h negativa", kind: "kill" };
  }

  const c1 = prev.active;
  const c2 = avg >= 0.2;
  const c3 = m1 >= 0.15;
  const c4 = m2 >= 0.15;

  if (c1 && c2 && c3 && c4) {
    return {
      label: "🟢 SCALE — ⚠️ verifica o dia da semana antes de escalar!",
      kind: "scale",
    };
  }

  let reason = "";
  if (!c1) reason = "C1: não esteve ativa no dia anterior";
  else if (!c2) reason = `C2: média de margem ${pct(avg)} < 20%`;
  else if (!c3) reason = `C3: margem Day 1 ${pct(m1)} < 15%`;
  else if (!c4) reason = `C4: margem Day 2 ${pct(m2)} < 15%`;

  return { label: `🟡 MAINTAIN — Day ${counter} · ${reason}`, kind: "maintain" };
}

/* ------------------------------------------------------------------ */
/* History — consecutive Day# + per-campaign context across days       */
/* ------------------------------------------------------------------ */

export interface DayContextEntry extends PrevDayContext {
  decision: Decision;
}

/**
 * Walk days 1..targetDay computing, for each campaign, its consecutive Day#
 * counter, margin and decision — returning the state AS OF `targetDay`.
 * Used to feed the *next* day's 48h evaluation and "Yesterday's Decision".
 *
 * Duplicate names within a day: the first occurrence is used for matching.
 */
export function computeContextForDay(
  entriesByDay: Map<number, RoasInput[]>,
  targetDay: number,
): Map<string, DayContextEntry> {
  let prev = new Map<string, DayContextEntry>();

  for (let d = 1; d <= targetDay; d++) {
    const rows = entriesByDay.get(d) ?? [];
    const cur = new Map<string, DayContextEntry>();

    for (const r of rows) {
      const name = r.campaignName.trim();
      if (!name || cur.has(name)) continue; // first occurrence wins

      const prevCtx: PrevDayContext = prev.get(name) ?? {
        active: false,
        marginPct: null,
        counter: 0,
      };
      const counter = dayCounter(name, r.totalSpend, prevCtx.counter);
      const { marginPct } = calcRoas(r);
      const decision = roasDecision(counter, r.totalSpend, marginPct, prevCtx);

      cur.set(name, {
        active: r.totalSpend > 0,
        marginPct,
        counter,
        decision,
      });
    }
    prev = cur;
  }

  return prev;
}
