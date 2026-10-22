"use client";
import { useState } from "react";
export function CheckoutButton({ plan, ready, portal = false }: { plan?: string; ready: boolean; portal?: boolean }) {
  const [pending,setPending] = useState(false); const [error,setError] = useState(""); const [accepted,setAccepted] = useState(false);
  async function open() {
    setPending(true); setError("");
    try { const response = await fetch(`/api/billing/${portal?"portal":"checkout"}`, { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan,acceptTerms:accepted}) }); const result=await response.json(); if(!response.ok || !result.url) throw new Error(result.error || "Não foi possível continuar."); const url=new URL(result.url); if(url.protocol!=="https:" || !["checkout.stripe.com","billing.stripe.com"].includes(url.hostname)) throw new Error("Destino de pagamento inválido."); window.location.assign(url.href); }
    catch(error){setError(error instanceof Error?error.message:"Tenta novamente.");setPending(false);}
  }
  return <div className="space-y-3">{!portal&&<label className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} className="mt-1"/> <span>Aceito os <a href="/termos" className="underline">termos</a> e a cobrança automática a cada período escolhido. Posso cancelar a próxima renovação a qualquer momento.</span></label>}<button onClick={open} disabled={pending||!ready||(!portal&&!accepted)} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45">{pending?"A abrir…":portal?"Gerir subscrição e cancelamento":ready?"Continuar para pagamento":"Subscrições disponíveis em breve"}</button>{error&&<p role="alert" className="text-sm text-amber-600">{error}</p>}</div>;
}
