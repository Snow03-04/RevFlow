import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSettings } from "@/lib/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { GeminiKeyForm } from "@/components/settings/gemini-key-form";
import { ThemeAccentPicker } from "@/components/settings/theme-accent-picker";
import { StoreFeeForm } from "@/components/settings/store-fee-form";
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
  const { data: stores, error: storesError } = await supabase.from("shopify_connections")
    .select("id,shop_name,shop_domain,eu_order_fee_enabled").eq("user_id", user.id).order("shop_name");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Define the cost assumptions that power your profit calculation."
      />
      <Card className="max-w-3xl">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Taxa UE por loja</CardTitle>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">2 € / encomenda</span>
          </div>
          <CardDescription>
            Aplica-se às encomendas pagas com destino à União Europeia, desde 23/10/2026, incluindo esse dia.
            Encomendas anteriores, de teste ou canceladas ficam excluídas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {storesError ? <p className="text-sm text-amber-500">Não foi possível carregar as taxas. Atualiza a página para tentar novamente.</p>
            : stores?.length ? stores.map(store => <StoreFeeForm key={store.id} store={{ id: store.id,
              name: store.shop_name ?? store.shop_domain, enabled: store.eu_order_fee_enabled }} />)
            : <p className="text-sm text-muted-foreground">Liga uma loja para configurares esta taxa.</p>}
          <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
            A taxa é um custo incluído nos COGS e no lucro, uma vez por encomenda. Não altera os valores cobrados aos clientes.
            Guardar recalcula esta loja desde 23/10/2026; desligar remove a taxa desse período.
            A conversão de 2 € segue a moeda e o câmbio da loja.
          </p>
        </CardContent>
      </Card>
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
          <CardTitle>Aparência</CardTitle>
          <CardDescription>
            Escolhe a cor de destaque da app. Muda tudo (sidebar, botões,
            gráficos, indicadores) na hora — a preferência fica guardada neste
            dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeAccentPicker />
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
