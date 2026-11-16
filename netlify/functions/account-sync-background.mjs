import { timingSafeEqual } from "node:crypto";

export default async function run(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.method !== "POST") return;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return;
  const { userId, slot, catalogueStore } = await request.json();
  const endpoint = new URL("/api/cron/sync", process.env.URL);
  async function call(step, failures = 0, failedTasks = []) {
    const res = await fetch(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(65_000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId, slot, step, failures, failedTasks }),
    });
    if (!res.ok) throw new Error(`Scheduled sync: HTTP ${res.status}`);
    return res.json();
  }
  if (catalogueStore) {
    for (const status of ["active", "draft", "archived"]) {
      let cursor;
      do {
        const page = await call({ kind: "products", id: catalogueStore, status, cursor });
        if (!page.ok) throw new Error("Catalogue page failed");
        cursor = page.next;
      } while (cursor);
    }
    return;
  }
  const plan = await call("plan");
  if (!plan.ok) throw new Error("Could not plan account refresh");
  if (!plan.stages.length) return;
  let failures = 0;
  const failedTasks = [];
  let totalsFailed = false;
  for (const stage of plan.stages) {
    if (stage.kind === "reports" && totalsFailed) continue;
    let next = 0;
    async function consume() {
      while (next < stage.tasks.length) {
        const { step, label } = stage.tasks[next++];
        try {
          const result = await call(step);
          if (!result.ok) throw new Error("Incomplete step");
        } catch {
          failures++;
          if (failedTasks.length < 30) failedTasks.push(label.slice(0, 160));
          if (stage.kind === "totals") totalsFailed = true;
          console.warn(`Account refresh: ${step.kind} failed`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, stage.tasks.length) }, consume));
  }
  await call("finish", failures, failedTasks);
  // Slow catalogue and inventory reads run independently of sales and balances.
  if (slot % 4 === 0) {
    const shops = plan.stages.flatMap(stage => stage.tasks)
      .filter(task => task.step.kind === "shopify");
    await Promise.all(shops.map(async task => {
      const res = await fetch(new URL("/.netlify/functions/account-sync-background", process.env.URL), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId, slot, catalogueStore: task.step.id }),
      });
      if (res.status !== 202) throw new Error(`Could not queue catalogue: HTTP ${res.status}`);
    }));
  }
}
