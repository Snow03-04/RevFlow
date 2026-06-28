/**
 * Pure, client-safe helpers for product localization: the language + currency
 * lists for the picker, and the "charm price" rounding. No network here.
 */

export interface Lang {
  code: string; // ISO 639-1 (what Google Translate expects)
  name: string; // Portuguese label for the picker
}

/** A broad list of languages supported by the free translation endpoint. */
export const LANGUAGES: Lang[] = [
  { code: "pt", name: "Português" },
  { code: "en", name: "Inglês" },
  { code: "es", name: "Espanhol" },
  { code: "fr", name: "Francês" },
  { code: "de", name: "Alemão" },
  { code: "it", name: "Italiano" },
  { code: "nl", name: "Neerlandês (Holandês)" },
  { code: "pl", name: "Polaco" },
  { code: "cs", name: "Checo" },
  { code: "sk", name: "Eslovaco" },
  { code: "ro", name: "Romeno" },
  { code: "hu", name: "Húngaro" },
  { code: "el", name: "Grego" },
  { code: "sv", name: "Sueco" },
  { code: "da", name: "Dinamarquês" },
  { code: "fi", name: "Finlandês" },
  { code: "no", name: "Norueguês" },
  { code: "is", name: "Islandês" },
  { code: "ga", name: "Irlandês" },
  { code: "ca", name: "Catalão" },
  { code: "gl", name: "Galego" },
  { code: "eu", name: "Basco" },
  { code: "ru", name: "Russo" },
  { code: "uk", name: "Ucraniano" },
  { code: "bg", name: "Búlgaro" },
  { code: "sr", name: "Sérvio" },
  { code: "hr", name: "Croata" },
  { code: "sl", name: "Esloveno" },
  { code: "lt", name: "Lituano" },
  { code: "lv", name: "Letão" },
  { code: "et", name: "Estónio" },
  { code: "tr", name: "Turco" },
  { code: "ar", name: "Árabe" },
  { code: "he", name: "Hebraico" },
  { code: "fa", name: "Persa (Farsi)" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "ur", name: "Urdu" },
  { code: "ta", name: "Tâmil" },
  { code: "th", name: "Tailandês" },
  { code: "vi", name: "Vietnamita" },
  { code: "id", name: "Indonésio" },
  { code: "ms", name: "Malaio" },
  { code: "fil", name: "Filipino (Tagalog)" },
  { code: "zh-CN", name: "Chinês (Simplificado)" },
  { code: "zh-TW", name: "Chinês (Tradicional)" },
  { code: "ja", name: "Japonês" },
  { code: "ko", name: "Coreano" },
  { code: "sw", name: "Suaíli" },
  { code: "af", name: "Africânder" },
  { code: "sq", name: "Albanês" },
  { code: "hy", name: "Arménio" },
  { code: "az", name: "Azerbaijano" },
  { code: "ka", name: "Georgiano" },
  { code: "mk", name: "Macedónio" },
  { code: "mt", name: "Maltês" },
];

export interface Currency {
  code: string;
  name: string;
}

/** Common store currencies for the source/target pickers. */
export const CURRENCIES: Currency[] = [
  { code: "EUR", name: "Euro (€)" },
  { code: "USD", name: "Dólar americano ($)" },
  { code: "GBP", name: "Libra (£)" },
  { code: "CZK", name: "Coroa checa (Kč)" },
  { code: "PLN", name: "Zloti polaco (zł)" },
  { code: "RON", name: "Leu romeno" },
  { code: "HUF", name: "Florim húngaro (Ft)" },
  { code: "BGN", name: "Lev búlgaro" },
  { code: "SEK", name: "Coroa sueca (kr)" },
  { code: "DKK", name: "Coroa dinamarquesa (kr)" },
  { code: "NOK", name: "Coroa norueguesa (kr)" },
  { code: "CHF", name: "Franco suíço (CHF)" },
  { code: "BRL", name: "Real brasileiro (R$)" },
  { code: "CAD", name: "Dólar canadiano (C$)" },
  { code: "AUD", name: "Dólar australiano (A$)" },
  { code: "JPY", name: "Iene japonês (¥)" },
  { code: "CNY", name: "Yuan chinês (¥)" },
  { code: "TRY", name: "Lira turca (₺)" },
  { code: "MXN", name: "Peso mexicano" },
  { code: "INR", name: "Rupia indiana (₹)" },
];

/**
 * "Charm" price: the smallest whole number ending in 9 that is >= value.
 * e.g. 123 -> 129, 120 -> 129, 129 -> 129, 130 -> 139. Always rounds UP so the
 * suggested price never sits below the converted amount.
 */
export function charmPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil((value - 9) / 10) * 10 + 9;
}
