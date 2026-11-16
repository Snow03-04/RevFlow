import "server-only";
import { resolveShopifyToken } from "./auth";
import { createLiveReader } from "../../../supabase/functions/_shared/live-snapshot";

export const readLiveSnapshot = createLiveReader(resolveShopifyToken);
