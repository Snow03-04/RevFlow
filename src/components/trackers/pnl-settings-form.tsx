"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/types/database";
import { savePnlSettings } from "@/lib/trackers/actions";
import {
  MoneyCell,
  PctCell,
} from "@/components/trackers/cells";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CURRENCIES = ["€", "$", "£"];

export function PnlSettingsForm({
  settings,
}: {
  settings: Tables<"pnl_settings">;
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [message, setMessage] = useState("");
  const [s, setS] = useState({
    currency: settings.currency,
    base_year: settings.base_year,
    feeFb: Number(settings.agency_fee_fb),
    feeGoogle: Number(settings.agency_fee_google),
    txFee: Number(settings.transaction_fee),
    paymentPct: Number(settings.payment_fee_pct ?? 0.025),
  });

  function save(next: typeof s) {
    setMessage("");
    startSave(async () => {
      try {
        const result = await savePnlSettings({
          currency: next.currency,
          base_year: next.base_year,
          agency_fee_fb: next.feeFb,
          agency_fee_google: next.feeGoogle,
          transaction_fee: next.txFee,
          payment_fee_pct: next.paymentPct,
        });
        setMessage(result.ok ? "Guardado. Histórico recalculado." : result.error ?? "Não foi possível guardar.");
        if (result.ok) router.refresh();
      } catch { setMessage("Não foi possível concluir. Tenta novamente."); }
    });
  }
  function update(patch: Partial<typeof s>) {
    setMessage("");
    setS((prev) => ({ ...prev, ...patch }));
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Definições do P&amp;L</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset disabled={saving} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Moeda</Label>
            <Select
              value={s.currency}
              onValueChange={(v) => update({ currency: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ano base</Label>
            <Input
              type="number"
              value={s.base_year}
              onChange={(e) =>
                update({ base_year: parseInt(e.target.value) || s.base_year })
              }
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">
            Pressupostos default (por mês podem ser sobrepostos)
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Agency Fee FB
              <PctCell value={s.feeFb} onChange={(v) => update({ feeFb: v })} />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Agency Fee Google
              <PctCell
                value={s.feeGoogle}
                onChange={(v) => update({ feeGoogle: v })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Taxa média (% da venda)
              <PctCell
                value={s.paymentPct}
                onChange={(v) => update({ paymentPct: v })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Taxa fixa (por encomenda)
              <MoneyCell
                value={s.txFee}
                onChange={(v) => update({ txFee: v })}
                currency={s.currency}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            A mesma taxa média é aplicada às vendas pagas de todas as lojas,
            na P&amp;L e no dashboard. As taxas reais mantêm-se em Recebimentos.
            A taxa fixa é cobrada uma vez por encomenda. As comissões de agência
            começam em 0% e podem ser configuradas se forem aplicáveis.
          </p>
        </div>
        <Button type="button" onClick={() => save(s)} disabled={saving}>{saving ? "A guardar e recalcular…" : "Guardar e recalcular"}</Button>
        </fieldset>
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
