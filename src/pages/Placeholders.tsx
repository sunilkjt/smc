function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="rounded-lg border border-edge bg-panel p-6 text-center text-sm text-mute">
        {body}
      </div>
    </div>
  );
}

export function History() {
  return (
    <Empty
      title="Signal History"
      body="No resolved signals yet. Lifecycle states (WAITING_FOR_SETUP, ACTIVE, INVALIDATED, EXPIRED, RESOLVED) and full event histories land with the signal engine in Phase 5."
    />
  );
}

export function PaperTrading() {
  return (
    <Empty
      title="Paper Trading"
      body="No simulated positions yet. Starting balance, position-risk %, fees/slippage, stop-first resolution and R-multiple tracking land in Phase 5. Real order placement will never be implemented."
    />
  );
}

export function Performance() {
  return (
    <Empty
      title="Strategy Performance"
      body="No completed trades yet — win rate, expectancy, profit factor and drawdown need real sample sizes and will appear here from Phase 6. Unfilled setups stay separate from paper trades; small samples will carry warnings."
    />
  );
}
