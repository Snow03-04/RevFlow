/** Shapes shared by the live globe's server reads, its Realtime messages and the view. */

/** An order as the globe draws it. No customer data: a town, rounded coordinates and a product name. */
export interface GlobeOrder {
  /** `<store id>:<Shopify order id>` — the same key from a webhook and from the database. */
  id: string;
  store: string;
  num: string;
  /** When Shopify processed it (ms since epoch). */
  ts: number;
  /** Order total in the order's own currency. */
  total: number;
  cur: string;
  /** The same total in the account's display currency. */
  amount: number;
  city: string;
  /** ISO 3166-1 alpha-2 country, or "" when unknown. */
  cc: string;
  lat: number | null;
  lng: number | null;
  /** First product's name; `more` counts the other lines. */
  title: string;
  more: number;
  /** A Shopify test order: drawn as a rehearsal and never counted. Only on Realtime messages. */
  test?: boolean;
}

export interface GlobeStore {
  key: string;
  name: string;
  cur: string;
  /** Country most of its recent orders ship to: where an order without coordinates is drawn. */
  home: string | null;
  color: string;
}

export interface GlobeState {
  sales?: import("@/lib/live/sales").GlobeSales;
  now: number;
  /** The day on screen in the account's timezone (yyyy-mm-dd): today, or the past day asked for. */
  day: string;
  /** That day's first instant and the next day's (ms since epoch). */
  start: number;
  end: number;
  timeZone: string;
  /** Display currency every `amount` is in. */
  currency: string;
  stores: GlobeStore[];
  orders: GlobeOrder[];
  /** The day before's orders as [second of day, amount, store index]. */
  prev: [number, number, number][];
  /** Previous days' totals per store, from the stored daily metrics. */
  week: Record<string, Record<string, { n: number; amount: number }>>;
  ads: { at: number; updated: number; today: Record<string, { amount: number; google: number; meta: number }> };
  /** Realtime topic of this account's live view (present on the API response). */
  topic?: string;
}

/** What a Realtime broadcast carries. */
export type GlobeMessage =
  | { t: "order"; o: GlobeOrder; test?: boolean }
  /** The same order again with what it is worth now (a post-purchase upsell, an edit). */
  | { t: "update"; o: GlobeOrder }
  | { t: "cancel"; id: string };
