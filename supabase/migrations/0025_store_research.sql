-- ============================================================================
-- 0025_store_research.sql
-- Store Research Hub: saved stores found while researching (competitors,
-- inspiration, top stores), mirroring the Product Research hub (0019).
-- Server-side filtering/search + indexes; owner-scoped RLS.
-- ============================================================================

create table if not exists public.research_stores (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null default '',
  url                text,                              -- store URL (homepage)
  niche              text,                              -- e.g. "Beauty", "Pets"
  status             text not null default 'watching',  -- watching|interesting|winner|competitor|archived
  tags               text[] not null default '{}',
  notes              text,
  favorite           boolean not null default false,
  image_url          text,                              -- og:image / logo (auto-scraped or manual)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_researched_at timestamptz
);

create index if not exists idx_research_stores_user_status
  on public.research_stores (user_id, status, created_at desc);
create index if not exists idx_research_stores_user_fav
  on public.research_stores (user_id, favorite);
create index if not exists idx_research_stores_tags
  on public.research_stores using gin (tags);

create trigger trg_research_stores_updated_at
  before update on public.research_stores
  for each row execute function public.set_updated_at();

alter table public.research_stores enable row level security;
create policy "research_stores_sel" on public.research_stores
  for select using (auth.uid() = user_id);
create policy "research_stores_ins" on public.research_stores
  for insert with check (auth.uid() = user_id);
create policy "research_stores_upd" on public.research_stores
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "research_stores_del" on public.research_stores
  for delete using (auth.uid() = user_id);
