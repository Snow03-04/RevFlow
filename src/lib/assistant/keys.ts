import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { decryptToken } from "@/lib/crypto";

/**
 * The current user's Gemini API key (decrypted), or null if they haven't set
 * one. The assistant is per-user: there is no shared/global key, so each user
 * brings (and pays for) their own. Stored encrypted in `settings`.
 */
export async function getUserGeminiKey(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("settings")
    .select("gemini_api_key_encrypted")
    .eq("user_id", userId)
    .maybeSingle();

  const enc = data?.gemini_api_key_encrypted;
  if (!enc) return null;
  try {
    return decryptToken(enc);
  } catch {
    return null; // corrupt/old payload — treat as "not set"
  }
}
