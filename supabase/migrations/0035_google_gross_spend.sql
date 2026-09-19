-- Keep the Google-reported cost separate from the cost paid after promotions.
-- NULL means an older script did not send it; never infer it from a zero cost.
alter table public.google_campaigns
  add column if not exists gross_spend numeric(14,2)
  check (gross_spend >= 0);

comment on column public.google_campaigns.gross_spend is
  'Google campaign cost before promotional credits, in the same currency as spend. NULL = not imported.';
notify pgrst, 'reload schema';
