import "server-only";

/**
 * Read a supplier cost sheet (a Google Sheet) as CSV. The sheet must be shared
 * "anyone with the link can view" — then the gviz endpoint returns it as CSV
 * without any OAuth. Expected columns (header row, in any order):
 *   order  | cost            | states
 *   1017   | €12.70          | paid        (blank state = still to pay)
 */

export interface SupplierRow {
  order: string; // normalised to digits only
  cost: number; // EUR (as written in the sheet)
  paid: boolean;
}

export interface SupplierCosts {
  byOrder: Map<string, SupplierRow>; // key = digits-only order number
  paidTotal: number;
  unpaidTotal: number;
  paidCount: number;
  unpaidCount: number;
}

/** Extract the spreadsheet id + gid from any Google Sheets URL. */
export function parseSheetRef(url: string): { id: string; gid: string } | null {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return { id, gid };
}

/** Very small CSV parser (handles quoted fields with commas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toNumber(raw: string): number | null {
  const n = parseFloat(
    raw.replace(/[€$£\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."),
  );
  return Number.isFinite(n) ? n : null;
}

/** Fetch + parse the supplier sheet. Returns null on any fetch/format failure. */
export async function fetchSupplierCosts(
  url: string,
): Promise<SupplierCosts | null> {
  const ref = parseSheetRef(url);
  if (!ref) return null;

  const csvUrl = `https://docs.google.com/spreadsheets/d/${ref.id}/gviz/tq?tqx=out:csv&gid=${ref.gid}`;
  let text: string;
  try {
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }

  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return null;

  // Locate the columns. A header row is used when present; sheets that start
  // straight into data are just as common, so fall back to inferring each
  // column from the values themselves.
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.some(
    (h) =>
      h.startsWith("order") ||
      h.startsWith("cost") ||
      h.startsWith("price") ||
      h.startsWith("state") ||
      h.startsWith("status"),
  );

  let iOrder: number;
  let iCost: number;
  let iState: number;

  if (hasHeader) {
    iOrder = header.findIndex((h) => h.startsWith("order"));
    iCost = header.findIndex(
      (h) => h.startsWith("cost") || h.startsWith("price"),
    );
    iState = header.findIndex(
      (h) =>
        h.startsWith("state") || h.startsWith("status") || h.startsWith("pag"),
    );
  } else {
    // No header — assume the documented column order: order, cost, state.
    iOrder = 0;
    iCost = 1;
    iState = 2;
  }
  if (iOrder < 0 || iCost < 0) return null;

  const byOrder = new Map<string, SupplierRow>();
  let paidTotal = 0;
  let unpaidTotal = 0;
  let paidCount = 0;
  let unpaidCount = 0;

  for (const r of hasHeader ? rows.slice(1) : rows) {
    const orderRaw = (r[iOrder] ?? "").trim();
    const order = orderRaw.replace(/\D/g, "");
    const cost = toNumber(r[iCost] ?? "");
    if (!order || cost == null) continue; // skip empty / not-yet-priced rows
    const stateRaw = (iState >= 0 ? r[iState] ?? "" : "").trim().toLowerCase();
    const paid = stateRaw === "paid" || stateRaw === "pago" || stateRaw === "yes" || stateRaw === "true";

    byOrder.set(order, { order, cost, paid });
    if (paid) {
      paidTotal += cost;
      paidCount++;
    } else {
      unpaidTotal += cost;
      unpaidCount++;
    }
  }

  return {
    byOrder,
    paidTotal: Math.round(paidTotal * 100) / 100,
    unpaidTotal: Math.round(unpaidTotal * 100) / 100,
    paidCount,
    unpaidCount,
  };
}
