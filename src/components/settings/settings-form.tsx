"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  updateSettingsAction,
  type SettingsState,
} from "@/lib/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settings } from "@/types";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      Save changes
    </Button>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action] = useActionState<SettingsState, FormData>(
    updateSettingsAction,
    {},
  );

  return (
    <form action={action} className="space-y-8">
      {state.ok && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> Settings saved and metrics
          recalculated.
        </div>
      )}
      {state.error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {state.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Field id="currency" label="Currency" hint="3-letter ISO code, e.g. USD, EUR.">
          <Input
            id="currency"
            name="currency"
            defaultValue={settings.currency}
            maxLength={3}
          />
        </Field>
        <Field
          id="timezone"
          label="Timezone"
          hint="IANA timezone used to bucket days, e.g. Europe/Lisbon."
        >
          <Input
            id="timezone"
            name="timezone"
            defaultValue={settings.timezone}
          />
        </Field>
        <Field
          id="fx_rate_override"
          label="Manual FX rate (optional)"
          hint="Pin your store→display rate so figures match your Shopify. Value = store-currency units per 1 display unit (e.g. 354 = “1 EUR = 354 HUF”). Leave blank to use the live ECB rate."
        >
          <Input
            id="fx_rate_override"
            name="fx_rate_override"
            type="number"
            step="0.0001"
            placeholder="auto (ECB)"
            defaultValue={settings.fx_rate_override ?? ""}
          />
        </Field>
        <Field
          id="default_product_cost_pct"
          label="Default product cost (%)"
          hint="Fallback COGS as a % of price when a product has no cost in Shopify."
        >
          <Input
            id="default_product_cost_pct"
            name="default_product_cost_pct"
            type="number"
            step="0.1"
            defaultValue={settings.default_product_cost_pct}
          />
        </Field>
        <Field
          id="default_shipping_cost"
          label="Shipping cost / order"
          hint="Flat fulfilment shipping cost you pay per order."
        >
          <Input
            id="default_shipping_cost"
            name="default_shipping_cost"
            type="number"
            step="0.01"
            defaultValue={settings.default_shipping_cost}
          />
        </Field>
        <Field
          id="payment_fee_pct"
          label="Payment fee (%)"
          hint="Processor percentage fee, e.g. 2.9."
        >
          <Input
            id="payment_fee_pct"
            name="payment_fee_pct"
            type="number"
            step="0.001"
            defaultValue={settings.payment_fee_pct}
          />
        </Field>
        <Field
          id="payment_fee_fixed"
          label="Payment fee (fixed / order)"
          hint="Fixed processor fee per order, e.g. 0.30."
        >
          <Input
            id="payment_fee_fixed"
            name="payment_fee_fixed"
            type="number"
            step="0.01"
            defaultValue={settings.payment_fee_fixed}
          />
        </Field>
      </div>

      <SaveButton />
    </form>
  );
}
