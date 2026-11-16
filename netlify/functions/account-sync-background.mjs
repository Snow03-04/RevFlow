import { timingSafeEqual } from "node:crypto";

export default async function run(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.method !== "POST") return;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return;
  const { userId, slot } = await request.json();
  const endpoint = new URL("/api/cron/sync", process.env.URL);
  async function call(step, failures = 0) {
    const res = await fetch(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(65_000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId, slot, step, failures }),
    });
    if (!res.ok) throw new Error(`Scheduled sync: HTTP ${res.status}`);
    return res.json();
  }
  const plan = await call("plan");
  if (!plan.ok) throw new Error("Could not plan account refresh");
  if (!plan.stages.length) return;
  let failures = 0;
  let totalsFailed = false;
  for (const stage of plan.stages) {
    if (stage.kind === "reports" && totalsFailed) continue;
    let next = 0;
    async function consume() {
      while (next < stage.tasks.length) {
        const { step } = stage.tasks[next++];
        try {
          const result = await call(step);
          if (!result.ok) throw new Error("Incomplete step");
        } catch {
          failures++;
          if (stage.kind === "totals") totalsFailed = true;
          console.warn(`Account refresh: ${step.kind} failed`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, stage.tasks.length) }, consume));
  }
  await call("finish", failures);
}
