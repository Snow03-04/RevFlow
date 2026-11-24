export const ACCENTS = ["cyan", "purple", "gold", "pulse"] as const;
export type Accent = (typeof ACCENTS)[number];
export const DEFAULT_ACCENT: Accent = "cyan";
export const ACCENT_KEY = "revflow-accent";
export const ACCENT_EVENT = "revflow:appearance";
/** "on" blurs profit figures until hovered (see .private-figure in globals.css). Off unless the owner asks. */
export const PRIVATE_FIGURES_KEY = "revflow-private-figures";

export function isAccent(value: unknown): value is Accent {
  return ACCENTS.includes(value as Accent);
}

/** Executed in the head, before content paints. Storage can be unavailable on mobile. */
export const appearanceScript = `(() => {
  // Hosting can insert whitespace beside its HTML comments in the head.
  // React expects only the rendered head elements when it hydrates the page.
  // Remove those inert text nodes before hydration, preserving every element.
  for (const node of Array.from(document.head.childNodes)) {
    if (node.nodeType === 3 && !node.textContent.trim()) node.remove();
  }
  const allowed = ${JSON.stringify(ACCENTS)};
  let accent;
  try { accent = localStorage.getItem('${ACCENT_KEY}'); } catch {}
  if (!allowed.includes(accent)) {
    try { accent = document.cookie.split('; ').find(c => c.startsWith('${ACCENT_KEY}='))?.split('=')[1]; } catch {}
  }
  document.documentElement.dataset.accent = allowed.includes(accent) ? accent : '${DEFAULT_ACCENT}';
  let hidden;
  try { hidden = localStorage.getItem('${PRIVATE_FIGURES_KEY}'); } catch {}
  if (hidden !== 'on' && hidden !== 'off') {
    try { hidden = document.cookie.split('; ').find(c => c.startsWith('${PRIVATE_FIGURES_KEY}='))?.split('=')[1]; } catch {}
  }
  document.documentElement.dataset.privateFigures = hidden === 'on' ? 'on' : 'off';
  let mode = 'dark';
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') mode = saved;
    else localStorage.setItem('theme', mode);
  } catch {}
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(mode);
  document.documentElement.style.colorScheme = mode;
})();`;

export function currentAccent(): Accent {
  const value = document.documentElement.dataset.accent;
  return isAccent(value) ? value : DEFAULT_ACCENT;
}

export function setAccent(accent: Accent) {
  document.documentElement.dataset.accent = accent;
  try { localStorage.setItem(ACCENT_KEY, accent); } catch { /* cookie fallback */ }
  try {
    document.cookie = `${ACCENT_KEY}=${accent}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* The choice still applies for this session. */ }
  window.dispatchEvent(new Event(ACCENT_EVENT));
}

export function subscribeAccent(onChange: () => void) {
  function onRestore() {
    let saved: string | null | undefined;
    try { saved = localStorage.getItem(ACCENT_KEY); } catch { /* cookie fallback */ }
    if (!isAccent(saved)) {
      try { saved = document.cookie.split("; ").find((c) => c.startsWith(`${ACCENT_KEY}=`))?.split("=")[1]; } catch { /* keep default */ }
    }
    document.documentElement.dataset.accent = isAccent(saved) ? saved : DEFAULT_ACCENT;
    onChange();
  }
  function onStorage(event: StorageEvent) {
    if (event.key !== ACCENT_KEY && event.key !== null) return;
    document.documentElement.dataset.accent = isAccent(event.newValue)
      ? event.newValue : DEFAULT_ACCENT;
    onChange();
  }
  window.addEventListener(ACCENT_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onRestore);
  return () => {
    window.removeEventListener(ACCENT_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onRestore);
  };
}

function savedPrivateFigures(): boolean {
  let saved: string | null | undefined;
  try { saved = localStorage.getItem(PRIVATE_FIGURES_KEY); } catch { /* cookie fallback */ }
  if (saved !== "on" && saved !== "off") {
    try { saved = document.cookie.split("; ").find((c) => c.startsWith(`${PRIVATE_FIGURES_KEY}=`))?.split("=")[1]; } catch { /* keep off */ }
  }
  return saved === "on";
}

/** Whether profit figures are blurred until hovered, on this device. */
export function privateFigures(): boolean {
  return document.documentElement.dataset.privateFigures === "on";
}

export function setPrivateFigures(on: boolean) {
  const value = on ? "on" : "off";
  document.documentElement.dataset.privateFigures = value;
  try { localStorage.setItem(PRIVATE_FIGURES_KEY, value); } catch { /* cookie fallback */ }
  try {
    document.cookie = `${PRIVATE_FIGURES_KEY}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* The choice still applies for this session. */ }
  window.dispatchEvent(new Event(ACCENT_EVENT));
}

export function subscribePrivateFigures(onChange: () => void) {
  function onRestore() {
    document.documentElement.dataset.privateFigures = savedPrivateFigures() ? "on" : "off";
    onChange();
  }
  function onStorage(event: StorageEvent) {
    if (event.key !== PRIVATE_FIGURES_KEY && event.key !== null) return;
    onRestore();
  }
  window.addEventListener(ACCENT_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onRestore);
  return () => {
    window.removeEventListener(ACCENT_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onRestore);
  };
}
