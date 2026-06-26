-- ============================================================================
-- 0009_campaign_atc.sql
-- Store Meta "add to cart" events per campaign/day so the ROAS tracker can
-- auto-fill the ATC column on import.
-- ============================================================================

alter table public.campaigns
  add column if not exists atc numeric(12,2) not null default 0;
