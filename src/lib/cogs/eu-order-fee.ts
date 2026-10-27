/** User-defined fulfilment cost, not a tax collected from customers.
 * Member-state list: https://european-union.europa.eu/principles-countries-history/eu-countries_en
 */
export const EU_ORDER_FEE_START = "2026-10-23";
export const EU_ORDER_FEE_EUR = 5;
export const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export function euOrderFee(ymd: string, country: string | null | undefined, amountInBase = 0): number {
  if (ymd < EU_ORDER_FEE_START || !EU_COUNTRY_CODES.has((country ?? "").trim().toUpperCase())) return 0;
  if (!Number.isFinite(amountInBase) || amountInBase < 0) throw new Error("Taxa UE inválida.");
  return amountInBase;
}

/** The supplier charges the fee inside an eligible order's sheet total: its
 * first `fee` is the EU fee, the remainder is merchandise. Never above the total. */
export function sheetIncludedEuFee(sheetCost: number, fee: number): number {
  return Math.min(fee, Math.max(0, sheetCost));
}
