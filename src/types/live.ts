export type LiveReading =
  | { status: "ok"; carts: number; checkouts: number; purchases: number; readAt: string }
  | { status: "denied" | "unavailable" };

export type StoreActivity = "active" | "inactive" | "unknown";
export type LiveStore = { id: string; name: string; domain: string; activity: StoreActivity | "pending"; reading?: LiveReading };
