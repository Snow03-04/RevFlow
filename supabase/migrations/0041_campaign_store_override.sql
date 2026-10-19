-- ============================================================================
-- 0041_campaign_store_override.sql
-- Let one Meta campaign belong to a different store than its ad account.
--
-- A Meta ad account is mapped to ONE store (meta_connections.
-- shopify_connection_id) and every campaign's spend follows that mapping. That
-- breaks when an ad account is handed over to a new store: remapping the
-- account moves the old store's whole history to the new one, and leaving it
-- puts the new store's spend on the old one.
--
--   * shopify_connection_id : the store this campaign's spend belongs to,
--                             overriding the ad account's mapping. NULL (the
--                             default, and every existing row) = follow the
--                             ad account, exactly as before.
--
-- The Meta sync carries a campaign's override onto every row it writes for it
-- and converts those rows into that store's currency.
-- Additive & non-destructive.
-- ============================================================================

alter table public.campaigns
  add column if not exists shopify_connection_id uuid
    references public.shopify_connections (id) on delete set null;

comment on column public.campaigns.shopify_connection_id is
  'Store this campaign''s spend belongs to, overriding meta_connections.shopify_connection_id. NULL = the ad account''s store.';

notify pgrst, 'reload schema';
