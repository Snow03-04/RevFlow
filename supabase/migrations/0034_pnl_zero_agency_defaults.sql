-- Agency fees are optional and start at zero for new P&L settings.
-- Existing explicit account settings and month overrides are preserved.
alter table public.pnl_settings
  alter column agency_fee_fb set default 0,
  alter column agency_fee_google set default 0;
