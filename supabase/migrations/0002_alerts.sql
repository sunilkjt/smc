-- Hyperliquid SMC Stocks — migration 0002
-- Alert bookkeeping for server-side scheduled scans.
--
-- RLS posture (documented): anon has NO policies on these tables by design,
-- so the publishable key alone can neither read nor write history from a
-- browser. All cross-run sync runs server-side (GitHub Actions) with the
-- service-role key, which bypasses RLS. If browser sync is ever introduced,
-- add scoped per-user policies first — do not open anon access.

alter table public.smc_signals
  add column if not exists alerted_at timestamptz;

-- Single-row paper account snapshot so scheduled runs share one account.
create table if not exists public.smc_paper_account (
  id integer primary key default 1 check (id = 1),
  starting_balance numeric not null,
  balance numeric not null,
  risk_pct numeric not null,
  fee_rate numeric not null,
  slippage_rate numeric not null,
  updated_at timestamptz not null default now()
);

alter table public.smc_paper_account enable row level security;
-- No anon/authenticated policies: service-role only (see posture note above).
