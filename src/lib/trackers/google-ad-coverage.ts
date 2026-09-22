type AdDay = {
  date: string; grossSpend: number | null; spendKnown: boolean;
  clicks: number; impressions: number; conversions: number;
};

/** Observed advertising metrics may be shown as partial. They must never stand
 * in for complete expenses when calculating profit, margins or period ROAS. */
export function summariseGoogleAdCoverage(days: AdDay[]) {
  const covered = days.filter((d) => d.spendKnown && d.grossSpend != null);
  const missingDates = [...new Set(days.filter((d) => !d.spendKnown || d.grossSpend == null).map((d) => d.date))].sort();
  const grossSpend = covered.length ? covered.reduce((sum, d) => sum + d.grossSpend!, 0) : null;
  const clicks = covered.reduce((sum, d) => sum + d.clicks, 0);
  const impressions = covered.reduce((sum, d) => sum + d.impressions, 0);
  const conversions = covered.reduce((sum, d) => sum + d.conversions, 0);
  return {
    grossSpend, missingDates, complete: days.length > 0 && !missingDates.length,
    cpc: grossSpend != null && clicks ? grossSpend / clicks : null,
    cpm: grossSpend != null && impressions ? grossSpend / impressions * 1000 : null,
    cpa: grossSpend != null && conversions ? grossSpend / conversions : null,
  };
}

export type GoogleAdCoverage = ReturnType<typeof summariseGoogleAdCoverage>;
