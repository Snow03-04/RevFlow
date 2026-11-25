// No metrics segment: active campaigns with no delivery yet must count too.
export const GOOGLE_DAILY_BUDGET_QUERY = "SELECT campaign.start_date_time, campaign.end_date_time, campaign.primary_status, campaign_budget.resource_name, campaign_budget.period, campaign_budget.amount_micros FROM campaign WHERE campaign.status = 'ENABLED'";

type BudgetRow = {
  campaign?: { startDateTime?: string; endDateTime?: string; startDate?: string; endDate?: string; primaryStatus?: string };
  campaignBudget?: { resourceName?: string; period?: string; amountMicros?: string | number };
};

/** Planning assumption requested by the owner: 2× on the scheduled first day,
 * 1× thereafter. This is not a promise of delivery or Google's spending limit.
 * Self-contained: also embedded in Google Ads Scripts. Shared budgets count once. */
export function googleDailyForecast(rows: BudgetRow[], today: string) {
  const budgets = new Map<string, { micros: number; first: boolean }>();
  let known = /^\d{4}-\d{2}-\d{2}$/.test(today);
  for (const row of rows) {
    const campaign = row.campaign;
    if (["PENDING", "ENDED", "PAUSED", "REMOVED"].includes(campaign?.primaryStatus ?? "")) continue;
    // Current Google API returns account-local timestamps; legacy reports used dates.
    const start = (campaign?.startDateTime ?? campaign?.startDate)?.slice(0, 10).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    const end = (campaign?.endDateTime ?? campaign?.endDate)?.slice(0, 10).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    if (start && start > today || end && end < today) continue;
    const b = row.campaignBudget, micros = Number(b?.amountMicros);
    if (!b?.resourceName || b.period !== "DAILY" || b.amountMicros == null || !Number.isSafeInteger(micros) || micros < 0)
      return { budget: null, forecast: null, firstDayExtra: null };
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) known = false;
    const previous = budgets.get(b.resourceName);
    if (previous && previous.micros !== micros) return { budget: null, forecast: null, firstDayExtra: null };
    budgets.set(b.resourceName, { micros, first: previous?.first === true || start === today });
  }
  let budget = 0, extra = 0;
  for (const b of budgets.values()) { budget += b.micros / 1e6; if (b.first) extra += b.micros / 1e6; }
  return { budget, forecast: known ? budget + extra : null, firstDayExtra: known ? extra : null };
}
