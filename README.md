# Hyperliquid SMC Stocks

Clean, low-noise stock-market signal scanner for equity markets on Hyperliquid,
with Smart Money Concepts (SMC) as the primary strategy. Analytical and
paper-trading only — **no live order placement, wallet signing, private keys, or
real-money execution, ever.**

Stock-linked perpetuals are **derivatives** and do not represent ownership of
company shares.

## Stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · lightweight-charts ·
Vitest · GitHub Pages + Actions. Signal math is deterministic and needs no AI
API. This project is independent of `crypto-paper` and `SMC-Stocks`.

## Quick start (Windows)

Requirements: Node.js 22+.

```powershell
cd C:\Users\sunil\Desktop\hyperliquid-smc-stocks
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run dev      # local dev server
& "C:\Program Files\nodejs\npm.cmd" test         # unit tests (Vitest)
& "C:\Program Files\nodejs\npm.cmd" run build    # typecheck + production build
& "C:\Program Files\nodejs\npm.cmd" run lint     # oxlint
& "C:\Program Files\nodejs\npm.cmd" run smoke:discovery  # live API smoke test
& "C:\Program Files\nodejs\npm.cmd" run scan         # headless signal scan (TOP_N=8)
$env:TOP_N="3"; & "C:\Program Files\nodejs\npm.cmd" run scan  # smaller scan
```

> `npm.ps1` may be blocked by the execution policy; invoking `npm.cmd` directly
> (as above) works without changing system policy.

## Environment variables

Copy `.env.example` to `.env`. All values are optional placeholders:

| Name | Purpose |
| --- | --- |
| `VITE_HL_API_BASE` | Hyperliquid API override (default `https://api.hyperliquid.xyz`) |
| `VITE_BASE_PATH` | Pages base path, e.g. `/hyperliquid-smc-stocks/` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Optional persistence (Phase 7) |

Server-side secrets (Telegram token, Supabase service key) must live in GitHub
Actions secrets or host env — never in `VITE_*` or the repo.

## How stock discovery works

1. `allPerpMetas` enumerates every asset on every DEX (DEX derived from each
   asset's own `dex:COIN` prefix, never array position).
2. `perpCategories` supplies builder-declared categories; only `stocks`/`stock`
   classify as equity. Everything else → `UNKNOWN`, excluded from signals.
3. `perpDexs` adds DEX display names (best-effort).
4. `candleSnapshot` fetches candles with full `dex:COIN` identifiers; only
   confirmed closed candles (`T <= now`) feed scoring — the forming candle is
   display-only.

Requests are sequential (≤3 concurrent), with timeouts, `Retry-After`-aware
backoff on HTTP 429/5xx, and strict response-shape validation. Failures throw;
they are never converted into empty market lists or empty signals.

## GitHub Pages deployment

1. Push to `main` on GitHub. The `pages.yml` workflow runs tests, builds with
   `GITHUB_PAGES=true`, and deploys `dist/`.
2. In repo settings → Pages, select **GitHub Actions** as the source.
3. If the repo name differs from `smc`, set the
   `VITE_BASE_PATH` repository variable/secret (e.g. `/my-repo/`) — the build
   uses `VITE_BASE_PATH`, falling back to `/smc/`.
4. Hash-based routing is used, so deep links work with no server rewrites.

The `scan.yml` workflow re-runs the discovery smoke test every 30 minutes as a
drift detector (full scheduled signal scanning arrives in Phase 7).

## Supabase (optional, Phase 7)

Not configured. The UI runs fully locally and reports persistence as
unavailable. When added: versioned `supabase/migrations/*`, RLS, publishable
key only in the frontend.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `429 Too Many Requests` in logs | Shared-IP rate budget; the client backs off automatically. Avoid parallel scans. |
| Dashboard shows connection error | Real outage, not an empty list. Retry; check https://api.hyperliquid.xyz status. |
| Empty candle window for a stock | Sparse after-hours trading; treated as no-data, never zero volume. |
| Market missing from stock list | No `stocks` builder category → `UNKNOWN`, excluded by design. |
| Blank page on Pages | Wrong base path — set `VITE_BASE_PATH` to `/<repo>/`. |

## What works now

- Live discovery of verified stock markets (dynamic, HIP-3 aware, UNKNOWN-excluded)
- Deterministic SMC engine: swings, BOS/CHoCH, liquidity sweeps, FVG, order
  blocks, multi-timeframe setups with entry/SL/TP and 1:2 minimum RR
- Signal lifecycle (WAITING_FOR_RETEST → ACTIVE → RESOLVED/INVALIDATED/EXPIRED)
  with stable ids and dedupe, persisted locally
- Paper trading: risk-based sizing (no leverage), fees + slippage, stop-first
  resolution, TP1 partials, R-multiples
- Performance analytics (win rate, expectancy, profit factor, drawdown, splits
  by strategy/market) with small-sample warnings
- Technical Confluence comparison strategy (disabled by default)
- Headless scan (`npm run scan`) + scheduled Actions workflow with artifact
- Telegram alert formatter + dispatch script (needs server-side secrets)

## Roadmap

- Supabase cloud sync (migration `supabase/migrations/0001_smc_stocks.sql` is
  ready; client sync pending — app stays local-only until then)
- Fine-tunable engine parameters per market, WebSocket live updates
