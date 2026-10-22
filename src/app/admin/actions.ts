"use server";
import { revalidatePath } from "next/cache";
import { billingRpc, requireAdmin } from "@/lib/billing/server";
import { z } from "zod";
export async function updateAdminAction(form: FormData) {
  const admin=await requireAdmin();
  const parsed=z.object({target:z.string().uuid(),action:z.enum(["grant_access","revoke_access","resolve_contact"])}).parse({target:form.get("target"),action:form.get("action")});
  await billingRpc("revflow_admin_update",{p_actor:admin.id,p_target:parsed.target,p_action:parsed.action});
  revalidatePath("/admin");
}
