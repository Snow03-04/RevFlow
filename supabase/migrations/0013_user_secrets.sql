-- ============================================================================
-- 0013_user_secrets.sql
-- Per-user secrets. The AI assistant no longer uses a single global Gemini key;
-- each user stores their OWN key, encrypted at rest with the same AES-256-GCM
-- scheme as the OAuth tokens (TOKEN_ENCRYPTION_KEY). RLS on `settings` already
-- restricts every row to its owner.
-- ============================================================================

alter table public.settings
  add column if not exists gemini_api_key_encrypted text;
