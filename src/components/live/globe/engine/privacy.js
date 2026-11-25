import { privateGlobe, subscribePrivateGlobe } from "@/lib/appearance";

// Settings → Privacidade has an option for the globe alone ("Esconder os valores
// no globo ao vivo"), apart from the dashboard's profit blur. It is stronger
// than the globe's optional, hover-to-reveal eye. Keep that eye's state intact
// so switching the option off restores the existing view.
export const PRIVATE_VALUES = ".odo, .kpis b, .chip b, .chip em, .amt, .fig, .pop b, #pace-pct, #week, #pace";

export function protectGlobeFigures(root, onChange) {
  const wrap = root.querySelector(".gw");
  const previousAria = new Map();
  function protectAccessibility() {
    for (const [element, value] of previousAria) {
      if (!privateGlobe() || !element.isConnected || !element.matches(PRIVATE_VALUES)) {
        if (value === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", value);
        previousAria.delete(element);
      }
    }
    if (!privateGlobe()) return;
    for (const element of root.querySelectorAll(PRIVATE_VALUES)) {
      if (!previousAria.has(element)) previousAria.set(element, element.getAttribute("aria-hidden"));
      element.setAttribute("aria-hidden", "true");
    }
  }
  function apply() {
    wrap.classList.toggle("private-money", privateGlobe());
    protectAccessibility();
  }
  // Apply before the first state read or animation can paint. CSS also covers
  // new rows/popups synchronously; the observer hides them from accessibility.
  apply();
  const observer = new MutationObserver(protectAccessibility);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  const unsubscribe = subscribePrivateGlobe(() => { apply(); onChange(); });
  return () => { unsubscribe(); observer.disconnect(); };
}
