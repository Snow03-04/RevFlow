// Netlify Scheduled Function — runs the data sync SERVER-SIDE every 15 minutes
// by calling the existing /api/cron/sync route (Shopify + Meta + Google, last
// few days). This replaces the old client-side auto-sync that fired heavy
// external API pulls on every dashboard open and blocked the user's clicks.
//
// Requires the CRON_SECRET env var to be set in Netlify (same value the route
// checks). Generate any long random string and add it under Site configuration
// → Environment variables.

export const config = { schedule: "*/15 * * * *" };

export default async () => {
  const base = process.env.URL || "https://revflowapp.netlify.app";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET not set", { status: 500 });
  }
  try {
    const res = await fetch(`${base}/api/cron/sync`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    return new Response(`sync ${res.status}`);
  } catch {
    return new Response("sync failed", { status: 500 });
  }
};
