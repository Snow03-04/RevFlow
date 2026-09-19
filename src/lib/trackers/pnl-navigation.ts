/** Keep campaign/store selection when navigating months, dashboard and settings. */
export function pnlUrl(query: string, changes: Record<string, string | null>, basePath = "/pnl"): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return `${basePath}${params.size ? `?${params.toString()}` : ""}`;
}
