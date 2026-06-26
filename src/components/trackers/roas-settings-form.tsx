"use client";

import { useState } from "react";
import type { Tables } from "@/types/database";
import { saveRoasSettings } from "@/lib/trackers/actions";
import { PctCell, useDebouncedSave } from "@/components/trackers/cells";
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

export function RoasSettingsForm({ settings }: { settings: Tables<"roas_settings"> }) {
  const debounce = useDebouncedSave(400);
  const [s, setS] = useState({
    currency: settings.currency,
    scale: Number(settings.roas_scale),
    maintain: Number(settings.roas_maintain),
    watch: Number(settings.roas_watch),
    minMargin: Number(settings.min_margin),
  });

  function update(patch: Partial<typeof s>) {
    setS((prev) => {
      const next = { ...prev, ...patch };
      debounce("settings", () =>
        saveRoasSettings({
          currency: next.currency,
          roas_scale: next.scale,
          roas_maintain: next.maintain,
          roas_watch: next.watch,
          min_margin: next.minMargin,
        }),
      );
      return next;
    });
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Definições do ROAS Tracker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Moeda</Label>
          <Select value={s.currency} onValueChange={(v) => update({ currency: v })}>
            <SelectTrigger className="w-32">
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

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-emerald-400">Scale ≥</Label>
            <Input type="number" step="0.1" value={s.scale} onChange={(e) => update({ scale: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="space-y-2">
            <Label className="text-amber-400">Maintain ≥</Label>
            <Input type="number" step="0.1" value={s.maintain} onChange={(e) => update({ maintain: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="space-y-2">
            <Label className="text-purple-400">Watch ≥</Label>
            <Input type="number" step="0.1" value={s.watch} onChange={(e) => update({ watch: parseFloat(e.target.value) || 0 })} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Margem mínima saudável</Label>
          <PctCell value={s.minMargin} onChange={(v) => update({ minMargin: v })} />
        </div>

        <p className="text-xs text-muted-foreground">
          Os thresholds do framework 48h (média ≥ 20%, ≥ 15%/dia, kill &lt; 0%)
          são fixos na lógica e não configuráveis. Guardado automaticamente.
        </p>
      </CardContent>
    </Card>
  );
}
