import "server-only";
import { revalidatePath } from "next/cache";

export function invalidateSyncedViews() {
  for (const path of ["/dashboard", "/connections", "/ads", "/products", "/pnl", "/finance/general", "/finance/meta", "/finance/google", "/roas", "/cogs-audit", "/supplier"]) {
    revalidatePath(path);
  }
}
