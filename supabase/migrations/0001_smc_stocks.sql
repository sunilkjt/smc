-- Hyperliquid SMC Stocks — migration 0001
-- Optional cloud persistence for signal history and paper trades.
-- The frontend works fully without Supabase; when these tables are absent or
-- unreachable the app reports persistence as unavailable (never pretended).
--
-- Apply with: supabase db push  (or run in the Supabase SQL editor)
-- Frontend uses ONLY the publishable key; RLS stays enabled. Service-role
-- key must never leave server-side environments.

create table if not exists public.smc_signals (
  id text primary key,
  strategy text not null check (strategy in ('smc', 'tech')),
  coin text not null,
  setup_timeframe text not null,
  direction text not null check (direction in ('long', 'short')),
  state text not null,
  setup jsonb,
  no_trade_reason text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entry_filled_at timestamptz,
  resolved_at timestamptz,
  resolution text
);

create table if not exists public.smc_paper_trades (
  id text primary key,
  signal_id text not null references public.smc_signals (id) on delete cascade,
  strategy text not null,
  coin text not null,
  direction text not null,
  entry numeric not null,
  stop_loss numeric not null,
  take_profit_1 numeric not null,
  take_profit_2 numeric not null,
  size numeric not null,
  risk_amount numeric not null,
  opened_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'closed')),
  tp1_taken boolean not null default false,
  exit_price numeric,
  exit_reason text,
  closed_at timestamptz,
  realized_pnl numeric,
  realized_r numeric,
  fees numeric not null default 0
);

create table if not exists public.smc_scans (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  dex_count integer not null,
  total_assets integer not null,
  verified_stocks integer not null,
  excluded integer not null,
  signals_new integer not null default 0,
  error text
);

create index if not exists smc_signals_coin_idx on public.smc_signals (coin);
create index if not exists smc_signals_strategy_state_idx on public.smc_signals (strategy, state);
create index if not exists smc_paper_trades_status_idx on public.smc_paper_trades (status);
create index if not exists smc_scans_ran_at_idx on public.smc_scans (ran_at desc);

alter table public.smc_signals enable row level security;
alter table public.smc_paper_trades enable row level security;
alter table public.smc_scans enable row level security;

-- Single-operator model: authenticated users manage their own history.
-- Adjust to stricter per-user policies if multi-user access is introduced.
drop policy if exists "owner read/write signals" on public.smc_signals;
create policy "owner read/write signals" on public.smc_signals
  for all to authenticated using (true) with check (true);

drop policy if exists "owner read/write paper trades" on public.smc_paper_trades;
create policy "owner read/write paper trades" on public.smc_paper_trades
  for all to authenticated using (true) with check (true);

drop policy if exists "owner read/write scans" on public.smc_scans;
create policy "owner read/write scans" on public.smc_scans
  for all to authenticated using (true) with check (true);
