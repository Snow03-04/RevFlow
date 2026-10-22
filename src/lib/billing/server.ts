import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { PlanId } from "./plans";

export type Membership = { user_id: string; role: "admin" | "member"; complimentary: boolean; customer_id: string | null; subscription_id: string | null; plan: PlanId | null; status: string; paid_until: string | null; cancel_at_period_end: boolean };
type RpcClient = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
/** Only import from trusted server code after authenticating the caller. */
export async function billingRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (createAdminClient() as unknown as RpcClient).rpc(name, args);
  if (error) throw new Error(`RevFlow account service failed: ${name}`);
  return data as T;
}
export const getMembership = cache((userId: string) => billingRpc<Membership>("revflow_account", { p_user_id: userId }));
export function hasAccess(m: Membership, now = Date.now()) { return m.role === "admin" || m.complimentary || (m.status === "active" && !!m.paid_until && Date.parse(m.paid_until) > now); }
export async function requireAdmin() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?redirectTo=%2Fadmin");
  const membership = await getMembership(user.id);
  if (membership.role !== "admin") redirect("/dashboard");
  return user;
}
