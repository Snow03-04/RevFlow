"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { saveGeminiKeyAction, type SettingsState } from "@/lib/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      Guardar chave
    </Button>
  );
}

export function GeminiKeyForm({ hasKey }: { hasKey: boolean }) {
  const [state, action] = useActionState<SettingsState, FormData>(
    saveGeminiKeyAction,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      {state.ok && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> Chave guardada.
        </div>
      )}
      {state.error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {state.error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="gemini_api_key">
          Chave Gemini{" "}
          {hasKey && (
            <span className="text-xs font-normal text-success">
              · configurada
            </span>
          )}
        </Label>
        <Input
          id="gemini_api_key"
          name="gemini_api_key"
          type="password"
          autoComplete="off"
          placeholder={
            hasKey
              ? "•••••••• (escreve uma nova para substituir)"
              : "Cola aqui a tua chave Gemini"
          }
        />
        <p className="text-xs text-muted-foreground">
          O assistente de IA usa a <strong>tua</strong> chave. Obtém uma grátis em{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Google AI Studio
          </a>
          . É guardada encriptada e nunca partilhada. Deixa vazio e guarda para a
          remover.
        </p>
      </div>

      <SaveButton />
    </form>
  );
}
