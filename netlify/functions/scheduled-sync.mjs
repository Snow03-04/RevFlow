export const config = { schedule: "*/15 * * * *" };

export default async () => {
  const response = await fetch(new URL("/api/cron/sync", process.env.URL), {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    redirect: "error", signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Scheduled sync dispatch failed: HTTP ${response.status}`);
};
