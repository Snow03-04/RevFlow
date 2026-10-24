"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveGoogleAccountState } from "@/lib/google/account-monitoring-actions";
import type { GoogleAccountOption, GoogleAccountState } from "@/lib/google/account-monitoring";

function AccountState({ account }: { account: GoogleAccountOption }) {
  const router = useRouter();
  const [state, setState] = useState<GoogleAccountState>(account.state);
  const [saved, setSaved] = useState(account.state);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const result = await saveGoogleAccountState(account.storeId, account.customerId, state);
      if (result.ok) { setSaved(state); setMessage("Estado guardado."); router.refresh(); }
      else setMessage(result.error ?? "Não foi possível guardar.");
    } catch { setMessage("Não foi possível guardar. Tenta novamente."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 border-t border-border pt-3">
    <p className="text-sm font-medium">{account.storeName} <span className="font-normal text-muted-foreground">· {account.customerId}</span></p>
    <div className="flex flex-wrap gap-2">
      <select aria-label={`Estado Google Ads — ${account.storeName} — ${account.customerId}`} value={state} disabled={busy}
        onChange={e => { setState(e.target.value as GoogleAccountState); setMessage(""); }}
        className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm">
        <option value="active">Ativa</option><option value="suspended">Suspensa</option><option value="inactive">Inativa / sem anúncios</option>
      </select>
      <Button variant="outline" disabled={busy || state === saved} onClick={save}>{busy ? "A guardar…" : "Guardar estado"}</Button>
    </div>
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
  </div>;
}

export function GoogleAccountMonitoring({ accounts }: { accounts: GoogleAccountOption[] }) {
  if (!accounts.length) return null;
  return <div id="google-account-status" className="space-y-3 rounded-lg border border-border p-3">
    <p className="text-sm font-medium">Estado das contas Google Ads</p>
    <p className="text-xs text-muted-foreground">Marca uma conta como suspensa ou inativa para deixar de receber avisos de atualização do script. Os gastos recebidos e a faturação por confirmar continuam nos relatórios. Quando voltares a anunciar, muda o estado para ativa.</p>
    {accounts.map(account => <AccountState key={`${account.storeId}:${account.customerId}:${account.state}`} account={account} />)}
  </div>;
}
