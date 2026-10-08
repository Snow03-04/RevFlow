import "server-only";
import { revalidatePath } from "next/cache";

export function invalidateSyncedViews() {
  for (const path of ["/dashboard", "/connections", "/ads", "/products", "/pnl", "/payments", "/finance/desde-sempre", "/finance/general", "/finance/meta", "/finance/google", "/roas", "/cogs-audit", "/supplier"]) {
    revalidatePath(path);
  }
}
