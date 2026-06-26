import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSettings } from "@/lib/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const settings = await getSettings(supabase, user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Define the cost assumptions that power your profit calculation."
      />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Profit & cost model</CardTitle>
          <CardDescription>
            Profit = Revenue − Product Cost − Shipping − Payment Fees − Refunds −
            Ad Spend. Saving recalculates the last 90 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings && <SettingsForm settings={settings} />}
        </CardContent>
      </Card>
    </div>
  );
}
