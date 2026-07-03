-- ============================================================================
-- 0017_google_login_customer.sql
-- Multi-tenant Google Ads: each connection stores its own login-customer-id
-- (the user's manager/MCC account id) so queries work per-user, instead of a
-- single global env var. Null = a standalone account queried directly.
-- Additive & non-destructive.
-- ============================================================================
alter table public.google_connections
  add column if not exists login_customer_id text;
