-- Hyperliquid SMC Stocks — migration 0003
-- Key/value metadata for server-side automation (Telegram poll offset, etc.).
-- Same RLS posture as 0002: no anon/authenticated policies; service-role only.

create table if not exists public.smc_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.smc_meta enable row level security;
-- No policies by design: service-role only (see 0002 posture note).
