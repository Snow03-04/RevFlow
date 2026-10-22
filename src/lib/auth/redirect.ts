/** Only navigate within the application; reject protocol-relative and encoded escapes. */
export function safeRedirect(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return fallback;
    const target = new URL(value, "https://revflow.invalid");
    return target.origin === "https://revflow.invalid" ? `${target.pathname}${target.search}${target.hash}` : fallback;
  } catch { return fallback; }
}
