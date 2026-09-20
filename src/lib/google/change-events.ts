/** Google account-local timestamps are kept as such; never reinterpret them as UTC. */
export type GoogleCampaignChange = {
  eventId: string;
  campaignId: string;
  changedAt: string;
  kind: "budget" | "status" | "bidding" | "campaign";
  oldBudget?: number | null;
  newBudget?: number | null;
};

export const GOOGLE_CHANGE_QUERY = `SELECT change_event.resource_name,
  change_event.change_date_time, change_event.change_resource_name,
  change_event.change_resource_type, change_event.campaign,
  change_event.resource_change_operation, change_event.changed_fields,
  change_event.old_resource, change_event.new_resource
  FROM change_event WHERE change_event.change_date_time DURING LAST_30_DAYS
  ORDER BY change_event.change_date_time DESC LIMIT 10000`;

export const GOOGLE_BUDGET_QUERY = "SELECT campaign.id, campaign.campaign_budget FROM campaign WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')";

export function googleChangeQuery(today: string) {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  // LAST_30_DAYS excludes today. Explicit bounds include edits made this morning.
  return GOOGLE_CHANGE_QUERY.replace("DURING LAST_30_DAYS", `BETWEEN '${from} 00:00:00' AND '${today} 23:59:59'`);
}

// This plain JavaScript also runs in the generated Google Ads Script. Keeping
// one reader prevents API imports and script imports from labelling edits differently.
export function readCampaignChanges(events: { changeEvent?: any }[], budgets: Record<string, string[]>): GoogleCampaignChange[] {
  const result: GoogleCampaignChange[] = [];
  events.forEach(function(row) {
    const e = row.changeEvent;
    if (!e || e.resourceChangeOperation !== "UPDATE") return;
    const fields = e.changedFields;
    const paths = Array.isArray(fields) ? fields : (fields && fields.paths) || String(fields || "").split(",");
    const mask = paths.join(" ").replace(/_/g, "").toLowerCase();
    const budget = e.changeResourceType === "CAMPAIGN_BUDGET" && /amountmicros|totalamountmicros/.test(mask);
    const campaign = e.changeResourceType === "CAMPAIGN";
    if (!budget && !campaign) return;
    const ids: string[] = budget ? (budgets[e.changeResourceName] || []) : [String(e.campaign || e.changeResourceName || "").split("/").pop() ?? ""];
    const kind = budget || /campaignbudget/.test(mask) ? "budget"
      : /status/.test(mask) ? "status"
      : /bidding|targetroas|targetcpa|maximize|manualcpc/.test(mask) ? "bidding" : "campaign";
    ids.forEach(function(id) {
      if (!/^\d+$/.test(id) || !e.changeDateTime || !e.resourceName) return;
      const oldBudget = e.oldResource && e.oldResource.campaignBudget;
      const newBudget = e.newResource && e.newResource.campaignBudget;
      result.push({ eventId: e.resourceName, campaignId: id, changedAt: e.changeDateTime,
        kind: kind,
        oldBudget: budget && oldBudget && oldBudget.amountMicros != null ? Number(oldBudget.amountMicros) / 1e6 : null,
        newBudget: budget && newBudget && newBudget.amountMicros != null ? Number(newBudget.amountMicros) / 1e6 : null });
    });
  });
  return result;
}
export const GOOGLE_CHANGE_READER = `var readCampaignChanges = ${readCampaignChanges.toString()};`;

export function changeDateLabel(changedAt: string, today: string) {
  const date = changedAt.slice(0, 10);
  const elapsed = Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86400000));
  const relative = elapsed === 0 ? "hoje" : elapsed === 1 ? "há 1 dia" : `há ${elapsed} dias`;
  return `${relative} · ${date.slice(8, 10)}/${date.slice(5, 7)}${date.slice(0, 4) !== today.slice(0, 4) ? `/${date.slice(0, 4)}` : ""}`;
}
