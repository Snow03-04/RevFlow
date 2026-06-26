import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertCircle, CheckCircle2, Megaphone } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getConnections } from "@/lib/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConnectShopify } from "@/components/connections/connect-shopify";
import { ConnectShopifyToken } from "@/components/connections/connect-shopify-token";
import { ConnectionCard } from "@/components/connections/connection-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Connections" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_shop: "That doesn't look like a valid Shopify domain.",
  state_mismatch: "Security check failed. Please try connecting again.",
  bad_hmac: "Could not verify the response from Shopify.",
  invalid_request: "The connection request was incomplete.",
  connection_failed: "We couldn't complete the connection. Please retry.",
  meta_denied: "Meta access was denied.",
  no_ad_accounts: "No ad accounts were found on this Meta profile.",
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    shopify?: string;
    meta?: string;
    error?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const { shopify, meta } = await getConnections(supabase, user.id);
  const successMsg =
    sp.shopify === "connected"
      ? "Shopify connected — your store is syncing."
      : sp.meta === "connected"
        ? "Meta Ads connected — campaigns are syncing."
        : null;
  const errorMsg = sp.error ? ERROR_MESSAGES[sp.error] ?? "Something went wrong." : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connections"
        description="Link your store and ad account. Data syncs automatically every 15 minutes."
      />

      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Shopify */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#95BF47]/15 text-[#95BF47]">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <path d="M15.3 3.3c-.1 0-.3.1-.4.1l-.7.2c-.4-1.1-1-1.6-1.9-1.6h-.2C11.5 1.3 10.9 1 10.4 1 8.6 1 7.7 3.3 7.4 4.4l-1.6.5c-.5.2-.5.2-.6.7L3.8 18.9l9.5 1.8 5.1-1.1S15.4 3.4 15.3 3.3zm-3.6.9-1.2.4c0-.6-.1-1.2-.3-1.7.7.1 1.2.8 1.5 1.3zm-2-1.6c.2.4.3 1 .3 1.7l-1.7.5c.3-1.2.9-1.9 1.4-2.2z" />
                </svg>
              </span>
              Shopify
            </CardTitle>
            <CardDescription>
              Sync orders, products, costs and refunds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {shopify.length > 0 ? (
              <div className="space-y-3">
                {shopify.map((c) => (
                  <ConnectionCard
                    key={c.id}
                    provider="shopify"
                    id={c.id}
                    title={c.shop_domain}
                    subtitle={c.scope ?? "Shopify Admin API"}
                    status={c.status}
                    lastSyncedAt={c.last_synced_at}
                    error={c.last_sync_error}
                  />
                ))}
                <div className="border-t border-border pt-4">
                  <ConnectShopify />
                </div>
                <ConnectShopifyToken />
              </div>
            ) : (
              <div className="space-y-4">
                <ConnectShopify />
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">ou</span>
                  </div>
                </div>
                <ConnectShopifyToken />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Meta */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1877F2]/15 text-[#1877F2]">
                <Megaphone className="h-5 w-5" />
              </span>
              Meta Ads
            </CardTitle>
            <CardDescription>
              Sync campaign spend, purchases and ROAS.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {meta.length > 0 ? (
              <div className="space-y-3">
                {meta.map((c) => (
                  <ConnectionCard
                    key={c.id}
                    provider="meta"
                    id={c.id}
                    title={c.ad_account_name ?? c.ad_account_id}
                    subtitle={`${c.ad_account_id}${
                      c.account_currency ? ` · ${c.account_currency}` : ""
                    }`}
                    status={c.status}
                    lastSyncedAt={c.last_synced_at}
                    error={c.last_sync_error}
                  />
                ))}
                <div className="border-t border-border pt-4">
                  <Button asChild variant="outline" className="w-full">
                    <a href="/api/meta/connect">Reconnect / add account</a>
                  </Button>
                </div>
              </div>
            ) : (
              <Button asChild className="w-full">
                <a href="/api/meta/connect">
                  <Megaphone className="h-4 w-4" /> Connect Meta Ads
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
