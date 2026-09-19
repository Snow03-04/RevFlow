/** Timers pause on mobile. Always listen for return-to-app and restored pages. */
export function observeRefreshLifecycle(refresh: () => void) {
  const wake = () => {
    if (document.visibilityState === "visible") refresh();
  };
  const initial = setTimeout(wake, 300);
  const interval = setInterval(wake, 120_000);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  window.addEventListener("online", wake);
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("pageshow", wake);
    window.removeEventListener("online", wake);
  };
}
