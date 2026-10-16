import { Link, NavLink, Outlet } from 'react-router-dom';

const NAV: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Dashboard' },
  { to: '/markets', label: 'Stock Markets' },
  { to: '/history', label: 'Signal History' },
  { to: '/paper', label: 'Paper Trading' },
  { to: '/performance', label: 'Performance' },
  { to: '/settings', label: 'Settings' },
];

function linkClass({ isActive }: { isActive: boolean }): string {
  return [
    'rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
    isActive ? 'bg-edge text-ink' : 'text-mute hover:text-ink hover:bg-panel',
  ].join(' ');
}

export default function Layout() {
  return (
    <div className="min-h-full bg-board text-ink">
      <header className="border-b border-edge bg-panel/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight">Hyperliquid SMC Stocks</span>
            <span className="mono text-[11px] text-mute">paper-trading scanner</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {NAV.map((item) =>
              item.to === '/' ? (
                <NavLink key={item.to} to={item.to} end className={linkClass}>
                  {item.label}
                </NavLink>
              ) : (
                <NavLink key={item.to} to={item.to} className={linkClass}>
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>
        </div>
        <div className="border-t border-edge/60">
          <p className="mx-auto max-w-6xl px-4 py-1.5 text-[11px] leading-snug text-mute">
            Analytical tool only — stock-linked perpetuals are derivatives and do not represent
            ownership of company shares. No live orders, no wallet signing, simulated paper trading
            only.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-[11px] text-mute">
        Data: Hyperliquid public API · Signals are deterministic (no AI) · SMC engine: Phase 4
      </footer>
    </div>
  );
}
