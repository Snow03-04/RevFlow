-- ============================================================================
-- 0028_shopify_client_credentials.sql
-- Support connecting a store via the Admin API OAuth *client_credentials* grant
-- (a custom app: API key + API secret key). For these connections we store the
-- API key in `client_id` and the (encrypted) API secret in `access_token`, and
-- exchange them for a short-lived shpat_ on each sync. `auth_type` distinguishes
-- them from legacy connections whose `access_token` already holds a shpat_.
-- Additive; tiny table, no lock/timeout risk.
-- ============================================================================

alter table public.shopify_connections
  add column if not exists auth_type text not null default 'token',
  add column if not exists client_id text;

notify pgrst, 'reload schema';
