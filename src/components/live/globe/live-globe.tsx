"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GlobeMessage, GlobeOrder, GlobeState } from "@/types/globe";
import type { PacingReport } from "@/lib/ads/pacing";

/**
 * The live globe: today's revenue, a 3D globe and every new order landing on it
 * the moment Shopify reports the sale. Any past day can be replayed on it.
 *
 * React only supplies the two things that belong to the app — the signed-in
 * state read and the Realtime channel. The view itself (WebGL scene, counters,
 * list) is a framework-free module mounted in a shadow root, loaded on demand
 * so three.js never reaches the other pages' bundles.
 */
export function LiveGlobe({ initialStore }: { initialStore?: string | null }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const supabase = createClient();
    const read = async <T,>(url: string, signal?: AbortSignal): Promise<T> => {
      const response = await fetch(url, { cache: "no-store", signal });
      if (response.status === 401) {
        window.location.assign("/login?redirectTo=%2Fglobe");
        throw new Error("unauthorized");
      }
      if (response.status === 402) {
        window.location.assign("/subscribe");
        throw new Error("unauthorized");
      }
      if (!response.ok) throw new Error(`state ${response.status}`);
      return response.json();
    };

    void import("./engine/controller").then(({ mountGlobe }) => {
      if (cancelled || !host.current) return;
      dispose = mountGlobe(host.current, {
        initialStore,
        loadState: () => read<GlobeState>("/api/live/globe"),
        loadSales: (signal: AbortSignal) => read("/api/live/globe/sales", signal),
        loadPacing: (signal: AbortSignal) => read<PacingReport>("/api/ads/pacing", signal),
        // A past day as it ended (yyyy-mm-dd), to replay it.
        loadDay: (day: string) => read<GlobeState>(`/api/live/globe?day=${encodeURIComponent(day)}`),
        subscribe(topic: string, onMessage: (message: GlobeMessage) => void, onStatus: (live: boolean) => void) {
          const channel = supabase.channel(topic, { config: { broadcast: { self: false } } })
            .on("broadcast", { event: "order" }, ({ payload }) => onMessage({ t: "order", o: payload as GlobeOrder, test: (payload as GlobeOrder).test === true }))
            .on("broadcast", { event: "update" }, ({ payload }) => onMessage({ t: "update", o: payload as GlobeOrder }))
            .on("broadcast", { event: "cancel" }, ({ payload }) => onMessage({ t: "cancel", id: String((payload as { id?: unknown }).id ?? "") }))
            .subscribe(status => onStatus(status === "SUBSCRIBED"));
          return () => { void supabase.removeChannel(channel); };
        },
      });
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [initialStore]);

  return <div ref={host} />;
}
