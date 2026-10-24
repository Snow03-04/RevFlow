import { z } from "zod";

export const googleAccountStateSchema = z.enum(["active", "suspended", "inactive"]);
export type GoogleAccountState = z.infer<typeof googleAccountStateSchema>;
export type GoogleAccountOption = { storeId: string; storeName: string; customerId: string; state: GoogleAccountState };

/** A user-declared monitoring preference, never financial or authorization evidence. */
export function googleAccountStateKey(storeId: string, customerId: string) {
  return `google_account_state_${storeId}_${customerId}`;
}

export function readGoogleAccountState(metadata: Record<string, unknown>, storeId: string, customerId: string): GoogleAccountState {
  const parsed = googleAccountStateSchema.safeParse(metadata[googleAccountStateKey(storeId, customerId)]);
  return parsed.success ? parsed.data : "active";
}
