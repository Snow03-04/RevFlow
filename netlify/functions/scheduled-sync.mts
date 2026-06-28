// Netlify Scheduled Function — replaces the Vercel cron.
// Runs every 15 minutes and triggers the app's sync endpoint, which re-syncs
// every active Shopify + Meta connection and refreshes metrics for ALL users.
// The heavy work stays in /api/cron/sync; this function is just the trigger.

export default async () => {
  const base = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!base || !secret) {
    console.error("scheduled-sync: missing URL or CRON_SECRET env var");
    return;
  }

  try {
    const res = await fetch(`${base}/api/cron/sync`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    console.log(`scheduled-sync: /api/cron/sync -> ${res.status}`);
  } catch (err) {
    console.error("scheduled-sync: request failed", err);
  }
};

// Every 15 minutes. Netlify reads this exported config at deploy time.
export const config = { schedule: "*/15 * * * *" };
