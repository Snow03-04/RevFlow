import "server-only";
import { serverEnv } from "@/lib/env";

/** Older APIs silently omit collections using Shopify's new sources model. */
export function collectionApiVersion(configured = serverEnv.shopify.apiVersion): string {
  return configured < "2026-07" ? "2026-07" : configured;
}
