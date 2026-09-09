-- ============================================================================
-- 0033_campaign_collection_links.sql
-- Track campaigns that advertise a COLLECTION landing page, not one product.
--
-- campaign_links already stores the `/products/<handle>` slug an ad links to.
-- A campaign whose ads point at `/collections/<handle>` had NO link at all, so
-- it fell through to campaign-name guessing, matched nothing, and showed real
-- spend against zero sales (a bogus -100% margin and a KILL suggestion).
--
--   * collection_handle : the `/collections/<handle>` slug the ads land on.
--   * link_kind         : which of the two the campaign's ads mostly point at
--                         ('product' | 'collection'), so the resolver knows
--                         what the campaign is really advertising when its ads
--                         carry both (e.g. a few product ads inside a mostly
--                         collection-led campaign).
--
-- Attribution for a collection campaign comes from the ORDER's landing_site
-- (migration 0021): a customer who landed on that collection page and bought
-- counts for the campaign, whatever they ended up buying.
-- Additive & non-destructive.
-- ============================================================================

alter table public.campaign_links
  add column if not exists collection_handle text;

alter table public.campaign_links
  add column if not exists link_kind text;

notify pgrst, 'reload schema';
