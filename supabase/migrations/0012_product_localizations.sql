-- ============================================================================
-- 0012_product_localizations.sql
-- Per-product localization: translated text + a currency-converted "charm"
-- price (ending in 9), keyed by product + target language. Display-only inside
-- RevFlow (the Shopify connection is read-only, so nothing is written back to
-- the store).
-- ============================================================================

create table if not exists public.product_localizations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  shopify_product_id text not null,
  lang               text not null,           -- target language (ISO code, e.g. "pt")
  title              text,                     -- translated product title
  description        text,                     -- translated description (future)
  variants           jsonb,                    -- [{ original, translated }]
  source_currency    text,
  target_currency    text,
  original_price     numeric(12,2),
  converted_price    numeric(12,2),            -- converted + charm-rounded
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, shopify_product_id, lang)
);

create index if not exists idx_product_localizations_user_lang
  on public.product_localizations (user_id, lang);

create trigger trg_product_localizations_updated_at
  before update on public.product_localizations
  for each row execute function public.set_updated_at();

alter table public.product_localizations enable row level security;

create policy "product_localizations_select_own" on public.product_localizations
  for select using (auth.uid() = user_id);
create policy "product_localizations_insert_own" on public.product_localizations
  for insert with check (auth.uid() = user_id);
create policy "product_localizations_update_own" on public.product_localizations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "product_localizations_delete_own" on public.product_localizations
  for delete using (auth.uid() = user_id);
