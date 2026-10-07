import { parseSheetRef } from "./sheet";

/** Keep the saved value a valid Google URL for older installations. App-only
 * fragment fields bind a tab to an owned store without a database migration. */
export function supplierConnection(value: string | null | undefined) {
  const ref = value ? parseSheetRef(value) : null;
  if (!ref) return null;
  const fragment = new URLSearchParams(new URL(value!).hash.slice(1));
  return {
    url: `https://docs.google.com/spreadsheets/d/${ref.id}/edit#gid=${ref.gid}`,
    storeId: fragment.get("revflow_store"),
    pendingRefresh: fragment.get("revflow_pending") === "1",
  };
}

export function supplierConnectionUrl(url: string, storeId: string, pendingRefresh = false) {
  const ref = parseSheetRef(url);
  if (!ref) throw new Error("Link de fornecedor inválido.");
  const fragment = new URLSearchParams({ gid: ref.gid, revflow_store: storeId });
  if (pendingRefresh) fragment.set("revflow_pending", "1");
  return `https://docs.google.com/spreadsheets/d/${ref.id}/edit#${fragment}`;
}
