"use client";

import { useState } from "react";
import type { Tables } from "@/types/database";
import { savePnlSettings } from "@/lib/trackers/actions";
import { MoneyCell, PctCell, useDebouncedSave } from "@/components/trackers/cells";
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

export function PnlSettingsForm({ settings }: { settings: Tables<"pnl_settings"> }) {
  const debounce = useDebouncedSave(400);
  const [s, setS] = useState({
    currency: settings.currency,
    base_year: settings.base_year,
    feeFb: Number(settings.agency_fee_fb),
    feeGoogle: Number(settings.agency_fee_google),
    txFee: Number(settings.transaction_fee),
  });

  function save(next: typeof s) {
    debounce("settings", () =>
      savePnlSettings({
        currency: next.currency,
        base_year: next.base_year,
        agency_fee_fb: next.feeFb,
        agency_fee_google: next.feeGoogle,
        transaction_fee: next.txFee,
      }),
    );
  }
  function update(patch: Partial<typeof s>) {
    setS((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Definições do P&amp;L</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Moeda</Label>
            <Select value={s.currency} onValueChange={(v) => update({ currency: v })}>
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
              onChange={(e) => update({ base_year: parseInt(e.target.value) || s.base_year })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Pressupostos default (por mês podem ser sobrepostos)</p>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Agency Fee FB
              <PctCell value={s.feeFb} onChange={(v) => update({ feeFb: v })} />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Agency Fee Google
              <PctCell value={s.feeGoogle} onChange={(v) => update({ feeGoogle: v })} />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Transaction Fee (por encomenda)
              <MoneyCell
                value={s.txFee}
                onChange={(v) => update({ txFee: v })}
                currency={s.currency}
              />
            </label>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Guardado automaticamente.</p>
      </CardContent>
    </Card>
  );
}
