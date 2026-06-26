-- ============================================================================
-- 0011_campaign_links.sql
-- Reliable campaign -> product matching.
--   * products.handle      : the Shopify product slug (from the product URL).
--   * campaign_links        : the product handle a Meta campaign's ads link to,
--                             resolved from the ad creative destination URL.
-- The ROAS/COG resolver prefers this link-based match over campaign-name
-- guessing, falling back to the name only when no link is available.
-- ============================================================================

alter table public.products
  add column if not exists handle text;

create table if not exists public.campaign_links (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  campaign_id    text not null,
  product_handle text,
  updated_at     timestamptz not null default now(),
  unique (user_id, campaign_id)
);

create index if not exists idx_campaign_links_user
  on public.campaign_links (user_id);

create trigger trg_campaign_links_updated_at
  before update on public.campaign_links
  for each row execute function public.set_updated_at();

alter table public.campaign_links enable row level security;

create policy "campaign_links_select_own" on public.campaign_links
  for select using (auth.uid() = user_id);
create policy "campaign_links_insert_own" on public.campaign_links
  for insert with check (auth.uid() = user_id);
create policy "campaign_links_update_own" on public.campaign_links
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "campaign_links_delete_own" on public.campaign_links
  for delete using (auth.uid() = user_id);
