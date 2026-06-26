import "server-only";
import { serverEnv } from "@/lib/env";

const GRAPH_BASE = () =>
  `https://graph.facebook.com/${serverEnv.meta.apiVersion}`;

/**
 * GET a Graph API edge and transparently follow cursor pagination,
 * yielding each page's `data` array. Retries once on rate-limit (code 17/613).
 */
export async function* graphPaginate<T = any>(
  path: string,
  params: Record<string, string>,
): AsyncGenerator<T[]> {
  let url = `${GRAPH_BASE()}/${path}?${new URLSearchParams(params)}`;

  while (url) {
    let res = await fetch(url, { cache: "no-store" });

    if (res.status === 429 || res.status === 613) {
      await new Promise((r) => setTimeout(r, 3000));
      res = await fetch(url, { cache: "no-store" });
    }

    const json = (await res.json()) as {
      data?: T[];
      paging?: { next?: string };
      error?: { message: string; code: number };
    };

    if (json.error) {
      throw new Error(`Meta Graph error ${json.error.code}: ${json.error.message}`);
    }

    yield json.data ?? [];
    url = json.paging?.next ?? "";
  }
}
