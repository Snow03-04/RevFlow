import { AUTO_REFRESH_MS } from "./protocol";

/** One timer, rearmed after completion. Wake events share the same due time. */
export function observeRefreshLifecycle(refresh: () => void | Promise<void>, getDelay?: () => number) {
  let stopped = false;
  let active = false;
  let due = 0;
  let timer: ReturnType<typeof setTimeout>;
  const available = () => document.visibilityState === "visible" && navigator.onLine !== false;
  const delay = () => Math.max(0, getDelay ? getDelay() : due - Date.now());
  function schedule(ms: number) {
    clearTimeout(timer);
    if (!stopped && available()) timer = setTimeout(wake, ms);
  }
  function wake() {
    clearTimeout(timer);
    if (stopped || active || !available()) return;
    const remaining = delay();
    if (remaining > 0) { schedule(remaining); return; }
    active = true;
    Promise.resolve().then(() => {
      if (!stopped && available()) return refresh();
    }).catch(() => {
      // The provider reports the error; a failed attempt must not stop polling.
    }).finally(() => {
      active = false;
      due = Date.now() + AUTO_REFRESH_MS;
      schedule(Math.max(1_000, delay()));
    });
  }
  schedule(300);
  document.addEventListener("visibilitychange", wake);
  for (const event of ["focus", "pageshow", "online", "offline"]) window.addEventListener(event, wake);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", wake);
    for (const event of ["focus", "pageshow", "online", "offline"]) window.removeEventListener(event, wake);
  };
}
