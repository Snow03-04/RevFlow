import { parseSheetRef } from "./sheet";

/** Keep the saved value a valid Google URL for older installations. App-only
 * fragment fields bind a tab to an owned store without a database migration. */
export function supplierConnections(value: string | null | undefined): SupplierConnection[] {
  const ref = value ? parseSheetRef(value) : null;
  if (!ref) return [];
  const fragment = new URLSearchParams(new URL(value!).hash.slice(1));
  const legacy = {
    url: `https://docs.google.com/spreadsheets/d/${ref.id}/edit#gid=${ref.gid}`,
    storeId: fragment.get("revflow_store"),
    pendingRefresh: fragment.get("revflow_pending") === "1",
  };
  const encoded = fragment.get("revflow_links");
  if (!encoded) return [legacy];
  let rows: unknown;
  try { rows = JSON.parse(encoded); } catch { throw new Error("Ligações do fornecedor inválidas."); }
  if (!Array.isArray(rows) || !rows.length) throw new Error("Ligações do fornecedor inválidas.");
  const stores = new Set<string>(), tabs = new Set<string>();
  return rows.map((row) => {
    const tab = typeof row?.url === "string" ? parseSheetRef(row.url) : null;
    if (!tab || typeof row.storeId !== "string" || !row.storeId || stores.has(row.storeId) || tabs.has(`${tab.id}:${tab.gid}`))
      throw new Error("Ligações do fornecedor repetidas ou inválidas.");
    stores.add(row.storeId); tabs.add(`${tab.id}:${tab.gid}`);
    return { url: `https://docs.google.com/spreadsheets/d/${tab.id}/edit#gid=${tab.gid}`,
      storeId: row.storeId, pendingRefresh: row.pendingRefresh === true };
  });
}

export interface SupplierConnection { url: string; storeId: string | null; pendingRefresh: boolean }

export function supplierConnection(value: string | null | undefined, storeId?: string) {
  const connections = supplierConnections(value);
  return (storeId ? connections.find((c) => c.storeId === storeId) : connections[0]) ?? null;
}

export function supplierConnectionUrl(url: string, storeId: string, pendingRefresh = false) {
  const ref = parseSheetRef(url);
  if (!ref) throw new Error("Link de fornecedor inválido.");
  const fragment = new URLSearchParams({ gid: ref.gid, revflow_store: storeId });
  if (pendingRefresh) fragment.set("revflow_pending", "1");
  return `https://docs.google.com/spreadsheets/d/${ref.id}/edit#${fragment}`;
}

function serialize(connections: SupplierConnection[]) {
  if (!connections.length) return null;
  const first = connections[0];
  if (!first.storeId) return first.url;
  const url = new URL(supplierConnectionUrl(first.url, first.storeId, first.pendingRefresh));
  if (connections.length > 1) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.set("revflow_links", JSON.stringify(connections));
    url.hash = fragment.toString();
  }
  return url.toString();
}

/** Update one store without losing the other tabs. A tab belongs to one store. */
export function upsertSupplierConnection(value: string | null | undefined, url: string, storeId: string, pendingRefresh = false) {
  const next = supplierConnection(supplierConnectionUrl(url, storeId, pendingRefresh))!;
  const saved = supplierConnections(value);
  const index = saved.findIndex((c) => c.storeId === storeId || c.url === next.url);
  const connections = saved.filter((c) => c.storeId && c.storeId !== storeId && c.url !== next.url);
  connections.splice(index < 0 ? connections.length : Math.min(index, connections.length), 0, next);
  return serialize(connections)!;
}

export function removeSupplierConnection(value: string | null | undefined, storeId?: string) {
  if (!storeId) return null;
  return serialize(supplierConnections(value).filter((c) => c.storeId !== storeId));
}
