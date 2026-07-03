-- ============================================================================
-- 0019_research.sql
-- Product Research Hub: saved products found during Meta Ad Library research,
-- with their collected ads grouped underneath. Built to scale to thousands of
-- products (server-side filtering/search/pagination + indexes).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- research_products
-- ----------------------------------------------------------------------------
create table if not exists public.research_products (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null default '',
  url                text,                              -- source/product URL
  brand              text,
  status             text not null default 'untested', -- untested|testing|winner|loser|scaling|archived
  tags               text[] not null default '{}',
  notes              text,
  favorite           boolean not null default false,
  image_url          text,                              -- main photo (first ad image or manual)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_researched_at timestamptz
);

create index if not exists idx_research_products_user_status
  on public.research_products (user_id, status, created_at desc);
create index if not exists idx_research_products_user_fav
  on public.research_products (user_id, favorite);
create index if not exists idx_research_products_tags
  on public.research_products using gin (tags);

create trigger trg_research_products_updated_at
  before update on public.research_products
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- research_ads  (grouped under a product; deduped by ad_archive_id)
-- ----------------------------------------------------------------------------
create table if not exists public.research_ads (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  product_id     uuid not null references public.research_products (id) on delete cascade,
  ad_archive_id  text not null,           -- Meta Ad Library ad id (from the pasted link)
  page_name      text,
  page_id        text,
  body           text,
  title          text,
  description    text,
  cta            text,
  link_url       text,                     -- ad's destination
  snapshot_url   text,                     -- link back to the ad in the Ad Library
  image_urls     text[] not null default '{}',
  video_url      text,
  countries      text[] not null default '{}',
  platforms      text[] not null default '{}',
  started_at     date,
  active         boolean not null default true,
  raw            jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (product_id, ad_archive_id)       -- never duplicate an ad within a product
);

create index if not exists idx_research_ads_user_product
  on public.research_ads (user_id, product_id, created_at desc);

create trigger trg_research_ads_updated_at
  before update on public.research_ads
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — owner-scoped
-- ----------------------------------------------------------------------------
alter table public.research_products enable row level security;
alter table public.research_ads      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['research_products', 'research_ads']
  loop
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id);', t || '_sel', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id);', t || '_ins', t);
    execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t || '_upd', t);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id);', t || '_del', t);
  end loop;
end;
$$;
