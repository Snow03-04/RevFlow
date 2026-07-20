"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, KeyRound } from "lucide-react";
import {
  connectShopifyTokenAction,
  type ActionResult,
} from "@/lib/connections/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-full">
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <KeyRound className="h-4 w-4" />
      )}
      Ligar com API token
    </Button>
  );
}

/**
 * Connect a real store via a custom-app Admin API token — no Partners OAuth or
 * app review required. Ideal for testing on your own production store.
 */
export function ConnectShopifyToken() {
  const [state, action] = useActionState<ActionResult, FormData>(
    connectShopifyTokenAction,
    {},
  );

  return (
    <details className="group rounded-lg border border-border bg-background/40 p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        <KeyRound className="h-4 w-4" />
        Ligar loja real com API token (custom app)
      </summary>

      <div className="mt-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Cria um app com os scopes de Admin API (orders, products, inventory) e
          cola aqui as credenciais do separador{" "}
          <span className="font-medium text-foreground">API credentials</span>: o{" "}
          <span className="font-medium text-foreground">ID de cliente</span> (API
          key) e a <span className="font-medium text-foreground">chave secreta</span>{" "}
          (<code>shpss_…</code>). Ligamos via <code>client_credentials</code> — sem
          precisar de instalar por OAuth.
        </p>

        {state.ok && (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Loja ligada — a sincronizar.
          </div>
        )}
        {state.error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
          </div>
        )}

        <form action={action} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="token-shop">Domínio da loja</Label>
            <Input
              id="token-shop"
              name="shop"
              placeholder="a-tua-loja.myshopify.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token-client-id">ID de cliente (API key)</Label>
            <Input
              id="token-client-id"
              name="client_id"
              placeholder="ex.: 49a5fd790532385a3aab16e220f124b4"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token">Chave secreta / API token</Label>
            <Input
              id="token"
              name="token"
              type="password"
              placeholder="shpss_•••••••••  (ou shpat_ se não usares Client ID)"
              autoComplete="off"
            />
          </div>
          <SubmitButton />
        </form>
      </div>
    </details>
  );
}
