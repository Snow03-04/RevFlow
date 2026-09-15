/** Keep the selected store when changing the dashboard's date range. */
export function dashboardPeriodUrl(
  currentQuery: string,
  period: string,
  from?: string,
  to?: string,
): string {
  const params = new URLSearchParams(currentQuery);
  params.set("period", period);
  params.delete("from");
  params.delete("to");
  if (period === "custom" && from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  return `/dashboard?${params.toString()}`;
}
