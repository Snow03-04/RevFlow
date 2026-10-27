/** User-defined fulfilment cost, not a tax collected from customers.
 * Member-state list: https://european-union.europa.eu/principles-countries-history/eu-countries_en
 */
export const EU_ORDER_FEE_START = "2026-10-23";
export const EU_ORDER_FEE_EUR = 5;
/** Already inside the supplier's totals before EU_ORDER_FEE_START added EUR 2. */
export const EU_ORDER_FEE_BEFORE_EUR = 3;
export const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/** The fee the supplier charged per eligible order on `ymd`, in EUR. */
export function euOrderFeeEur(ymd: string): number {
  return ymd < EU_ORDER_FEE_START ? EU_ORDER_FEE_BEFORE_EUR : EU_ORDER_FEE_EUR;
}

/** `eurToBase` is the EUR rate into the store's base currency, 0 when disabled. */
export function euOrderFee(ymd: string, country: string | null | undefined, eurToBase = 0): number {
  if (!EU_COUNTRY_CODES.has((country ?? "").trim().toUpperCase())) return 0;
  if (!Number.isFinite(eurToBase) || eurToBase < 0) throw new Error("Taxa UE inválida.");
  return euOrderFeeEur(ymd) * eurToBase;
}

/** The supplier charges the fee inside an eligible order's sheet total: its
 * first `fee` is the EU fee, the remainder is merchandise. Never above the total. */
/** Configured prices (collections, tiers, product/variant costs, % of price)
 * were copied from supplier totals that already carried the EUR 3 charged
 * before EU_ORDER_FEE_START, once per order. Never above those prices. */
export function configuredIncludedEuFee(configuredCost: number, eurToBase = 0): number {
  return Math.min(EU_ORDER_FEE_BEFORE_EUR * eurToBase, Math.max(0, configuredCost));
}

export function sheetIncludedEuFee(sheetCost: number, fee: number): number {
  return Math.min(fee, Math.max(0, sheetCost));
}
