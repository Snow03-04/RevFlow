import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSettings } from "@/lib/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { GeminiKeyForm } from "@/components/settings/gemini-key-form";
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
  const hasGeminiKey = !!settings?.gemini_api_key_encrypted;

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
          {/* Never ship the encrypted key to the browser. */}
          {settings && (
            <SettingsForm
              settings={{ ...settings, gemini_api_key_encrypted: null }}
            />
          )}
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>AI assistant</CardTitle>
          <CardDescription>
            The assistant runs on your own Gemini key (free tier is plenty).
            Without a key it stays disabled — nothing else is affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeminiKeyForm hasKey={hasGeminiKey} />
        </CardContent>
      </Card>
    </div>
  );
}
