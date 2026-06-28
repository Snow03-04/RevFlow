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

/**
 * Margin % as seen by the DECISION engine (not the display).
 *
 * `calcRoas` returns marginPct = null whenever store_value is 0. That happens in
 * two very different situations:
 *   - the campaign simply had no spend that day → genuinely empty (null), OR
 *   - the campaign HAD ad spend but made 0 sales → it lost the whole spend.
 *
 * The second case is a total loss and must count as NEGATIVE margin (so it can
 * trigger KILL / the 48h comparison), not as "no data". We represent it as
 * -100% (-1). The display column still shows "-" for null, per spec.
 */
export function decisionMarginFrom(
  marginPct: number | null,
  spend: number,
): number | null {
  if (marginPct !== null) return marginPct; // real margin (store_value > 0)
  return spend > 0 ? -1 : null; // spent with no sales = -100%; else truly empty
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
  | "maintain"
  | "none";

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

/** Round a margin ratio (0.18) to a whole-percent string ("18%"). */
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Per-campaign daily decision — implements the spec exactly. The decision is
 * driven 100% by margin % (never ROAS). ROAS thresholds only colour columns.
 *
 * Order is OBLIGATORY:
 *   0) spend 0          → empty (no decision)
 *   1) Day 1            → new campaign, observe
 *   2) odd Day# > 1     → fresh observation window, wait for next (even) day
 *   3) even Day# ≥ 2    → EVALUATE: monitor → kill → scale → maintain (in order)
 *   4) otherwise        → "—"
 *
 * `media_48h` (48h average margin) uses today's margin alone when yesterday's
 * margin is empty/absent; otherwise the mean of the two days.
 */
export function roasDecision(
  counter: number,
  spend: number,
  marginToday: number | null,
  prev: PrevDayContext,
): Decision {
  // 0) inactive today — no decision.
  if (spend === 0) return { label: "", kind: "empty" };

  // 1) brand-new campaign — Day 1 is observation only.
  if (counter === 1)
    return {
      label: "🆕 Campanha Nova — Dia 1 (próxima avaliação: Dia 2)",
      kind: "new",
    };

  // 2) odd Day# > 1 — start of a fresh 48h window, wait for the paired day.
  if (counter % 2 === 1 && counter > 1)
    return {
      label: `⏸ Nova Janela — Dia ${counter} (esperar pelo Dia ${counter + 1} para avaliar)`,
      kind: "window",
    };

  // 3) even Day# ≥ 2 — the evaluation day.
  if (counter % 2 === 0 && counter >= 2) {
    const m1 = prev.marginPct; // margem_ontem (null = vazio: não existia ontem)
    const m2 = marginToday; // margem_hoje
    const ativaOntem = prev.active;

    // media_48h: yesterday empty → use today alone; otherwise the mean.
    let media: number | null;
    if (m1 === null && m2 === null) media = null;
    else if (m1 === null) media = m2;
    else if (m2 === null) media = m1;
    else media = (m1 + m2) / 2;

    const fmt = (x: number | null) => (x === null ? "n/d" : pct(x));

    // 3a) Recovery — tested BEFORE kill (recovery has priority over killing).
    if (m1 !== null && m1 < 0 && m2 !== null && m2 >= 0.1) {
      return {
        label: `⏳ MONITORIZAR 24h — Dia 1 negativo (${pct(m1)}) mas a recuperar (${pct(
          m2,
        )}). Deixar correr 24h.`,
        kind: "monitor",
      };
    }

    // 3b) Kill — 48h average margin negative.
    if (media !== null && media < 0) {
      return {
        label: "🔴 KILL / DESCALE — média de margem 48h negativa",
        kind: "kill",
      };
    }

    // 3c) Scale — ALL four conditions must hold.
    const c1 = ativaOntem; // active yesterday (the 48h window exists)
    const c2 = media !== null && media >= 0.2; // 48h average margin ≥ 20%
    const c3 = m1 !== null && m1 >= 0.15; // Day 1 margin ≥ 15%
    const c4 = m2 !== null && m2 >= 0.15; // Day 2 margin ≥ 15%
    if (c1 && c2 && c3 && c4) {
      return {
        label: "🟢 SCALE (sugestão) — ⚠️ Verifica o dia da semana antes de escalar!",
        kind: "scale",
      };
    }

    // 3d) Maintain — show the FIRST condition that failed, in order.
    let reason = "";
    if (!c1) reason = "C1: não ativa ontem";
    else if (!c2) reason = `C2: média margem ${fmt(media)} < 20%`;
    else if (!c3) reason = `C3: margem Dia 1 ${fmt(m1)} < 15%`;
    else if (!c4) reason = `C4: margem Dia 2 ${fmt(m2)} < 15%`;

    return {
      label: `🟡 MAINTAIN — Dia ${counter} (próxima avaliação: Dia ${counter + 1}) · ${reason}`,
      kind: "maintain",
    };
  }

  // 4) fallthrough (e.g. counter 0 with spend) — no decision.
  return { label: "—", kind: "none" };
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
      const decMargin = decisionMarginFrom(marginPct, r.totalSpend);
      const decision = roasDecision(counter, r.totalSpend, decMargin, prevCtx);

      cur.set(name, {
        active: r.totalSpend > 0,
        marginPct: decMargin,
        counter,
        decision,
      });
    }
    prev = cur;
  }

  return prev;
}
