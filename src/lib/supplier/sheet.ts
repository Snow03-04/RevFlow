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
  cost: number; // Original amount, in this row's currency.
  currency?: string | null;
  paid: boolean;
}

export interface SupplierCosts {
  byOrder: Map<string, SupplierRow>; // key = digits-only order number
  /** Only available without conversion when all rows use one currency. */
  paidTotal: number | null;
  unpaidTotal: number | null;
  paidCount: number;
  unpaidCount: number;
  currency: string | null;
  errors: string[];
  unpricedOrders: string[];
  /** Batch totals, including totals accidentally sharing an order-number row. */
  summaryRows?: { order: string | null; cost: number; currency?: string | null; matchedOrders: number; componentOrders?: string[] }[];
}

/** Extract the spreadsheet id + gid from any Google Sheets URL. */
export function parseSheetRef(url: string): { id: string; gid: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com")
    return null;
  const id = parsed.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
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

/** The cell's own symbol/code wins over a column heading such as cost(USD). */
function currenciesIn(raw: string): string[] {
  const found = new Set<string>();
  for (const code of raw.toUpperCase().match(/\b(?:EUR|USD|GBP)\b/g) ?? []) found.add(code);
  for (const [symbol, code] of [["€", "EUR"], ["$", "USD"], ["£", "GBP"]])
    if (raw.includes(symbol)) found.add(code);
  return [...found];
}

export function parseSupplierAmount(raw: string): number | null {
  if (currenciesIn(raw).length > 1) return null;
  let value = raw.replace(/\b(?:EUR|USD|GBP)\b|US\$/gi, "").replace(/[€$£\s\u00a0]/g, "");
  if (!value || !/^[\d.,]+$/.test(value)) return null;
  if (value.includes(",") && value.includes(".")) {
    const decimal = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
    value = value.replace(decimal === "," ? /\./g : /,/g, "").replace(",", ".");
  } else if (value.includes(",")) value = value.replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
    const res = await fetch(csvUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }

  return parseSupplierCsv(text);
}

export function parseSupplierCsv(text: string): SupplierCosts | null {
  if (/^\s*</.test(text)) return null; // login/error HTML is not a sheet
  const rows = parseCsv(text.replace(/^\uFEFF/, "")).filter((r) =>
    r.some((c) => c.trim() !== ""),
  );
  if (rows.length === 0) return null;

  // Locate the columns. A header row is used when present; sheets that start
  // straight into data are just as common, so fall back to inferring each
  // column from the values themselves.
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const costHeader = (h: string) => /^(?:(?:total|unit)\s+)?(?:cost|price|custo|preço|preco)\b/.test(h);
  const hasHeader = header.some(
    (h) =>
      h.startsWith("order") ||
      costHeader(h) ||
      h.startsWith("price") ||
      h.startsWith("state") ||
      h.startsWith("status") ||
      h.startsWith("encomenda") ||
      h.startsWith("custo"),
  );

  let iOrder: number;
  let iCost: number;
  let iState: number;

  if (hasHeader) {
    iOrder = header.findIndex(
      (h) => h.startsWith("order") || h.startsWith("encomenda"),
    );
    iCost = header.findIndex(
      (h) =>
        costHeader(h),
    );
    iState = header.findIndex(
      (h) =>
        h.startsWith("state") || h.startsWith("status") || h.startsWith("pag") || h.startsWith("payment"),
    );
    // A named order/cost pair but an UNNAMED third column is common: the state
    // is filled in row by row and its header never gets typed. Without this,
    // every row reads as unpaid — a tab of 62 paid orders came through as the
    // full amount still owed, and got written to the DB that way.
    if (iState < 0 && rows[0].length > 2) {
      const positional = [0, 1, 2].find((i) => i !== iOrder && i !== iCost);
      if (positional != null && header[positional] === "") iState = positional;
    }
  } else {
    // No header — assume the documented column order: order, cost, state.
    iOrder = 0;
    iCost = 1;
    iState = 2;
  }
  if (iOrder < 0 || iCost < 0) return null;
  const headingCurrencies = hasHeader ? currenciesIn(header[iCost]) : [];
  const headerCurrency = headingCurrencies.length === 1 ? headingCurrencies[0] : null;
  const iCurrency = hasHeader ? header.findIndex((h) => /^(currency|moeda)$/.test(h)) : -1;

  const byOrder = new Map<string, SupplierRow>();
  let paidTotal = 0;
  let unpaidTotal = 0;
  let paidCount = 0;
  let unpaidCount = 0;
  const errors: string[] = [];
  const unpricedOrders: string[] = [];
  const currencies = new Set<string>();
  const summaryRows: NonNullable<SupplierCosts["summaryRows"]> = [];
  let block = new Map<string, number>(); // cents, unique orders since last total
  let verifiedBatchLayout = false;
  let blockCents = 0;
  let blockMax = 0;
  let blockCurrency: string | null = null;
  function clearBlock() { block = new Map(); blockCents = 0; blockMax = 0; blockCurrency = null; }

  for (const r of hasHeader ? rows.slice(1) : rows) {
    const orderRaw = (r[iOrder] ?? "").trim();
    const order = orderRaw.replace(/\D/g, "");
    const rawCost = (r[iCost] ?? "").trim();
    const cost = parseSupplierAmount(rawCost);
    const explicit = currenciesIn(rawCost);
    const columnCurrency = iCurrency >= 0 ? (r[iCurrency] ?? "").trim().toUpperCase() : "";
    const currency = explicit[0] ?? (columnCurrency || headerCurrency);
    if (cost != null && (explicit.length > 1 || (columnCurrency &&
      (!["EUR", "USD", "GBP"].includes(columnCurrency) || (explicit[0] && explicit[0] !== columnCurrency))))) {
      errors.push(`Moeda inválida ou contraditória na encomenda ${order}.`);
      clearBlock();
      continue;
    }
    if (block.size && currency !== blockCurrency) clearBlock();
    if (!orderRaw || !order || /total|subtotal|balance|amount due|to pay|a pagar|por pagar|saldo/i.test(orderRaw)) {
      if (cost != null) {
        const matched = block.size >= 2 && Math.round(cost * 100) === blockCents;
        verifiedBatchLayout ||= matched;
        summaryRows.push({ order: null, cost, currency, matchedOrders: matched ? block.size : 0 });
        clearBlock();
      }
      continue;
    }
    if (!rawCost) {
      unpricedOrders.push(order);
      clearBlock();
      continue;
    }
    if (cost == null) {
      errors.push(`Custo inválido na encomenda ${order}.`);
      clearBlock();
      continue;
    }
    // Some supplier tabs fill order numbers down into their payment-total row.
    // Recognise that row only in an established batch layout, with an exact
    // cent-for-cent sum of >=5 orders and a total >3x every component. A high
    // amount alone, or an ordinary small basket matching two costs, is not proof.
    const cents = Math.round(cost * 100);
    if (verifiedBatchLayout && block.size >= 5 && cents === blockCents && cents > 3 * blockMax) {
      summaryRows.push({ order, cost, currency, matchedOrders: block.size, componentOrders: [...block.keys()] });
      unpricedOrders.push(order); // this real order still needs its own quote
      clearBlock();
      continue;
    }
    if (currency) currencies.add(currency);
    const stateRaw = (iState >= 0 ? (r[iState] ?? "") : "")
      .trim()
      .toLowerCase();
    const paid =
      stateRaw === "paid" ||
      stateRaw === "pago" ||
      stateRaw === "yes" ||
      stateRaw === "true";

    const previous = byOrder.get(order);
    if (previous && (previous.cost !== cost || previous.paid !== paid || previous.currency !== currency)) {
      errors.push(
        `A encomenda ${order} aparece repetida com valores diferentes.`,
      );
      continue;
    }
    byOrder.set(order, { order, cost, currency, paid });
    blockCurrency = currency;
    blockCents += cents - (block.get(order) ?? 0);
    blockMax = Math.max(blockMax, cents);
    block.set(order, cents);
  }
  for (const row of byOrder.values()) {
    if (row.currency) continue;
    if (currencies.size > 1) errors.push(`Falta a moeda do custo na encomenda ${row.order}. Indica EUR ou USD nessa linha.`);
    else row.currency = currencies.size === 1 ? [...currencies][0] : headerCurrency;
  }
  // Count the same logical rows that will actually be applied, never duplicates.
  for (const { cost, paid } of byOrder.values()) {
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
    paidTotal: currencies.size > 1 ? null : Math.round(paidTotal * 100) / 100,
    unpaidTotal: currencies.size > 1 ? null : Math.round(unpaidTotal * 100) / 100,
    paidCount,
    unpaidCount,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    errors,
    unpricedOrders,
    summaryRows,
  };
}

export interface SheetTab {
  gid: string;
  name: string;
}

/** Google escapes a few characters inside the JS it embeds in /htmlview. */
function unescapeTabName(raw: string): string {
  return raw
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\\(.)/g, "$1");
}

/**
 * List the spreadsheet's tabs, so the merchant picks "Finland" from a dropdown
 * instead of hand-editing #gid= in the URL — the step where a store quietly
 * ends up reading another store's tab. Read from /htmlview, which embeds the
 * tab strip as `items.push({name: "CZ", … gid: "0"})`; same public-link access
 * the CSV export already needs, no OAuth. [] when unreadable.
 */
export async function listSheetTabs(url: string): Promise<SheetTab[]> {
  const ref = parseSheetRef(url);
  if (!ref) return [];
  try {
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${ref.id}/htmlview`,
      { cache: "no-store", signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const tabs: SheetTab[] = [];
    const seen = new Set<string>();
    const re =
      /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)"[\s\S]{0,400}?gid:\s*"(\d+)"/g;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      if (seen.has(m[2])) continue;
      seen.add(m[2]);
      tabs.push({ gid: m[2], name: unescapeTabName(m[1]) });
    }
    return tabs;
  } catch {
    return [];
  }
}
