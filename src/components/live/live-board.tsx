"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, Eye, EyeOff, Store } from "lucide-react";
import { Logo } from "@/components/brand";
import type { LiveStore } from "@/types/live";
import s from "./live-board.module.css";

const columns = [
  { key: "carts", label: "Carrinhos ativos", compact: "Carrinhos" },
  { key: "checkouts", label: "Chegaram ao checkout", compact: "Checkout" },
  { key: "purchases", label: "Comprado", compact: "Comprado" },
] as const;

const groups = [
  { activity: "active", label: "Ativas · Vendas nas últimas 72 h" },
  { activity: "inactive", label: "Sem vendas nas últimas 72 h" },
  { activity: "unknown", label: "Atividade por confirmar" },
  { activity: "pending", label: "A verificar vendas…" },
] as const;

function StoreCard({ store, position, hidden, failed }: {
  store: LiveStore; position: number; hidden: boolean; failed: boolean;
}) {
  const reading = store.reading;
  const ready = reading?.status === "ok";
  const hasPurchases = ready || reading?.status === "orders";
  const denied = reading?.status === "denied";
  const unavailable = failed || reading?.status === "unavailable";
  const status = failed ? "Última leitura" : ready ? "Em direto" : reading?.status === "orders" ? "Encomendas da loja online" : denied ? "Sem acesso aos relatórios" : unavailable ? "Indisponível" : "A consultar";
  const time = hasPurchases ? new Date(reading.readAt).toLocaleTimeString("pt-PT") : null;
  const handle = store.domain?.replace(/\.myshopify\.com$/i, "");
  const peak = ready ? Math.max(1, reading.carts, reading.checkouts, reading.purchases) : 1;
  return (
    <article className={s.card} aria-labelledby={`store-${store.id}`}>
      <header className={s.cardHead}>
        <span className={s.storeIcon}><Store size={17} aria-hidden="true" /></span>
        <h2 id={`store-${store.id}`}>
          {hidden ? <><span className="sr-only">Loja {position}</span><span aria-hidden="true" className={s.mask}>Nome da loja</span></> :
            <a className={s.name} href={handle ? `https://admin.shopify.com/store/${encodeURIComponent(handle)}/analytics/live` : undefined}
              target="_blank" rel="noopener noreferrer" title="Abrir o Live View na Shopify">{store.name}</a>}
        </h2>
        <span className={s.status} data-ready={hasPurchases && !failed} title={time ? `${status} · Consultado às ${time}` : status}>
          <i aria-hidden="true" />{hasPurchases ? <time dateTime={reading.readAt}><span className="sr-only">Consultado às </span>{time}</time> : status}
        </span>
      </header>
      <dl className={s.metrics} data-ready={ready}>
        {columns.map(({ key, label, compact }, i) => {
          const value = ready ? reading[key] : key === "purchases" && hasPurchases ? reading.purchases : null;
          const nextKey = columns[i + 1]?.key ?? key;
          const plotStyle = ready ? {
            "--stage-top": `${100 - 100 * reading[key] / peak}%`,
            "--next-top": `${100 - 100 * reading[nextKey] / peak}%`,
          } as CSSProperties : undefined;
          return (
            <div key={key}>
              <dt><span className={s.fullLabel}>{label}</span><span className={s.compactLabel} aria-hidden="true">{compact}</span></dt>
              <dd className={s.value}>{value !== null ? value.toLocaleString("pt-PT") : <span aria-label={status}>—</span>}</dd>
              <dd className={s.plot} style={plotStyle} aria-hidden="true" />
            </div>
          );
        })}
      </dl>
    </article>
  );
}

export function LiveBoard({ initialStores, initialError, userId }: { initialStores: LiveStore[]; initialError: boolean; userId: string }) {
  const [stores, setStores] = useState(initialStores);
  const [hidden, setHidden] = useState(true);
  const [failed, setFailed] = useState(initialError);
  const numberedStores = stores.map((store, index) => ({ store, position: index + 1 }));

  useEffect(() => {
    const cacheKey = `revflow:live:v1:${userId}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
      if (saved && Date.now() - saved.time < 10 * 60_000 && Array.isArray(saved.stores)) {
        setStores(current => current.map(store => {
          const prior = saved.stores.find((entry: LiveStore) => entry.id === store.id);
          return prior ? { ...store, reading: prior.reading, activity: prior.activity } : store;
        }));
      }
    } catch { /* Tab storage can be disabled. */ }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let pending: AbortController | null = null;

    async function refresh() {
      clearTimeout(timer);
      if (disposed || document.hidden || pending) return;
      if (!navigator.onLine) {
        setFailed(true);
        return;
      }
      const request = new AbortController();
      pending = request;
      const deadline = setTimeout(() => request.abort(), 20_000);
      try {
        const response = await fetch("/api/live", { cache: "no-store", signal: request.signal });
        if (disposed || request.signal.aborted) return;
        if (response.status === 401 || response.status === 402) {
          try { sessionStorage.removeItem(cacheKey); } catch { /* Storage unavailable. */ }
          window.location.replace(response.status === 401 ? "/login?redirectTo=%2Flive" : "/subscribe");
          return;
        }
        if (!response.ok) throw new Error("live");
        const { stores: next } = await response.json() as { stores: LiveStore[] };
        if (!disposed && !request.signal.aborted) {
          setStores(next);
          setFailed(false);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), stores: next.map(({ id, reading, activity }) => ({ id, reading, activity })) }));
          } catch { /* The mounted board still retains its current reading. */ }
        }
      } catch {
        if (!disposed && pending === request) setFailed(true);
      } finally {
        clearTimeout(deadline);
        if (pending === request) {
          pending = null;
          if (!disposed && !document.hidden) timer = setTimeout(refresh, 30_000);
        }
      }
    }

    function pause() {
      clearTimeout(timer);
      pending?.abort();
      pending = null;
      setHidden(true);
    }
    function offline() {
      pause();
      setFailed(true);
    }
    function visibility() {
      if (document.hidden) pause();
      else void refresh();
    }
    void refresh();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", visibility);
    window.addEventListener("offline", offline);
    window.addEventListener("online", visibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      pending?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("pageshow", visibility);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", visibility);
    };
  }, [userId]);

  return (
    <main className={s.screen}>
      <div className={s.inner}>
        <header className={s.intro}>
          <div className={s.bar}>
            <Logo />
            <button type="button" className={s.eye} aria-label="Ocultar nomes das lojas" aria-pressed={hidden}
              title={hidden ? "Mostrar nomes das lojas" : "Ocultar nomes das lojas"} onClick={() => setHidden(!hidden)}>
              {hidden ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
          <div className={s.heading}>
            <h1>Lojas em direto</h1>
            <p>{(stores.length > 0 || !failed) && <>{stores.length} {stores.length === 1 ? "loja ligada" : "lojas ligadas"}<span aria-hidden="true"> · </span></>}Últimos 10 minutos</p>
          </div>
        </header>
        {failed && <p role="status" className={s.message}>Ligação interrompida. A tentar novamente…</p>}
        {stores.length > 0 ? groups.map(({ activity, label }) => {
          const members = numberedStores.filter(({ store }) => (store.activity ?? "unknown") === activity);
          if (!members.length) return null;
          return <section key={activity} className={s.group} aria-labelledby={`group-${activity}`}>
            <h2 className={s.groupTitle} id={`group-${activity}`}>{label} <span>{members.length}</span></h2>
            <div className={s.grid}>
              {members.map(({ store, position }) => <StoreCard key={store.id} store={store} hidden={hidden} position={position} failed={failed} />)}
            </div>
          </section>;
        }) : !failed && <div className={s.empty}><Store size={28} /><p>Ainda não tens lojas ligadas.</p><Link href="/connections">Ligar uma loja Shopify <ArrowRight size={15} /></Link></div>}
        <footer className={s.footer}>
          <Link prefetch={false} href="/dashboard">Dashboard <ArrowRight size={16} aria-hidden="true" /></Link>
        </footer>
      </div>
    </main>
  );
}
