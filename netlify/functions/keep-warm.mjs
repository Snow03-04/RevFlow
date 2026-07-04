// Netlify Scheduled Function — pings the site every 5 minutes so the Next.js
// SSR handler stays warm. Without this, the function goes cold after a few idle
// minutes and the user's first click (e.g. switching dashboard periods) pays a
// slow cold start on top of the US↔EU database latency.
//
// Free plan: scheduled functions are allowed; ~8.6k invocations/month, well
// within the request budget.

export const config = { schedule: "*/5 * * * *" };

export default async () => {
  const base = process.env.URL || "https://revflowapp.netlify.app";
  try {
    await fetch(`${base}/api/ping`, { cache: "no-store" });
  } catch {
    // Best-effort: warming only, nothing to handle on failure.
  }
  return new Response("warmed");
};
