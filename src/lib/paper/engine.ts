/**
 * Paper trading: local simulation only — never real orders.
 *
 * Conservative execution assumptions (documented, tested):
 * - Positions open only from ACTIVE (filled) signals, one per signal.
 * - Entry executes at the limit price worsened by slippage
 *   (long buy pays entry×(1+slippage); short sell receives entry×(1−slippage)).
 * - A candle touching a level does NOT fill: penetration must be strict
 *   (long TP needs high > TP; long stop needs low < SL).
 * - Same-candle stop+target ambiguity resolves stop-first (pessimistic).
 * - TP1 closes HALF the position; the runner continues to TP2 or the
 *   original stop. The stop is never moved after entry.
 * - Taker fee (`feeRate` of notional) accrues on every leg (entry + exits).
 * - Position size = riskAmount / stopDistance, capped so notional ≤ equity
 *   (no leverage; the cap can only shrink risk, never inflate it).
 * - R-multiple = total realized PnL / actual risk after slippage.
 * - Unresolved positions stay open. History is never deleted or rewritten.
 */
import type {
  Candle,
  ClosedTrade,
  PaperAccount,
  PaperPosition,
  Signal,
  SignalDirection,
} from '../types.ts';

export interface PaperConfig {
  startingBalance: number;
  riskPct: number;
  feeRate: number;
  slippageRate: number;
}

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  startingBalance: 10_000,
  riskPct: 1,
  feeRate: 0.00045,
  slippageRate: 0.0002,
};

export function createAccount(config: Partial<PaperConfig> = {}): PaperAccount {
  const merged = { ...DEFAULT_PAPER_CONFIG, ...config };
  if (!(merged.startingBalance > 0)) throw new Error('startingBalance must be > 0');
  if (!(merged.riskPct > 0 && merged.riskPct <= 100)) throw new Error('riskPct must be (0, 100]');
  return {
    startingBalance: merged.startingBalance,
    balance: merged.startingBalance,
    riskPct: merged.riskPct,
    feeRate: merged.feeRate,
    slippageRate: merged.slippageRate,
    openPositions: [],
    closedTrades: [],
  };
}

function slip(price: number, dir: SignalDirection, leg: 'entry' | 'exit', slippage: number): number {
  // Worsen every fill by slippage (documented pessimism).
  if (dir === 'long') return leg === 'entry' ? price * (1 + slippage) : price * (1 - slippage);
  return leg === 'entry' ? price * (1 - slippage) : price * (1 + slippage);
}

function pnlFor(dir: SignalDirection, size: number, exitPx: number, entryPx: number): number {
  return dir === 'long' ? size * (exitPx - entryPx) : size * (entryPx - exitPx);
}

/**
 * Open a paper position from a filled (ACTIVE) signal. Returns the position,
 * or null when no position may be opened (wrong state, missing setup, or the
 * signal already has one). Applies entry fee + slippage immediately.
 */
export function openFromSignal(
  account: PaperAccount,
  signal: Signal,
  openedAt: number,
): { account: PaperAccount; position: PaperPosition | null } {
  if (signal.state !== 'ACTIVE' || signal.setup == null) return { account, position: null };
  if (
    account.openPositions.some((p) => p.signalId === signal.id) ||
    account.closedTrades.some((t) => t.signalId === signal.id)
  ) {
    return { account, position: null }; // one position per signal, never reopen
  }
  const setup = signal.setup;
  const stopDist = Math.abs(setup.entry - setup.stopLoss);
  if (!(stopDist > 0) || !Number.isFinite(stopDist)) return { account, position: null };

  const equity = account.balance;
  let riskAmount = equity * (account.riskPct / 100);
  let size = riskAmount / stopDist;
  const fillPrice = slip(setup.entry, setup.direction, 'entry', account.slippageRate);
  let notional = size * fillPrice;
  if (notional > equity) {
    // No-leverage cap: shrink size (risk falls with it).
    size = equity / fillPrice;
    notional = equity;
    riskAmount = size * Math.abs(fillPrice - setup.stopLoss);
  }
  if (!(size > 0)) return { account, position: null };
  const entryFee = notional * account.feeRate;

  const position: PaperPosition = {
    id: `paper:${signal.id}`,
    signalId: signal.id,
    strategy: signal.strategy,
    coin: signal.coin,
    direction: setup.direction,
    entry: fillPrice,
    stopLoss: setup.stopLoss,
    takeProfit1: setup.takeProfit1,
    takeProfit2: setup.takeProfit2,
    size,
    riskAmount,
    openedAt,
    status: 'open',
    tp1Taken: false,
    exitPrice: null,
    exitReason: null,
    closedAt: null,
    realizedPnl: null,
    realizedR: null,
    fees: entryFee,
  };
  return {
    account: {
      ...account,
      balance: account.balance - entryFee,
      openPositions: [...account.openPositions, position],
    },
    position,
  };
}

interface LegResult {
  position: PaperPosition;
  balanceDelta: number;
  closed: boolean;
}

function closeLeg(
  position: PaperPosition,
  fraction: number,
  exitRaw: number,
  reason: PaperPosition['exitReason'],
  closedAt: number,
  feeRate: number,
  slippage: number,
): LegResult {
  const legSize = position.size * fraction;
  const exitPx = slip(exitRaw, position.direction, 'exit', slippage);
  const legNotional = legSize * exitPx;
  const fee = legNotional * feeRate;
  const legPnl = pnlFor(position.direction, legSize, exitPx, position.entry) - fee;
  const closedFully = fraction >= 1;
  const totalPnl = (position.realizedPnl ?? 0) + legPnl;
  const updated: PaperPosition = {
    ...position,
    size: closedFully ? position.size : position.size - legSize,
    tp1Taken: position.tp1Taken || reason === 'TP1',
    fees: position.fees + fee,
    realizedPnl: totalPnl,
  };
  if (closedFully) {
    const done: PaperPosition = {
      ...updated,
      status: 'closed',
      exitPrice: exitPx,
      exitReason: reason,
      closedAt,
      realizedR: position.riskAmount > 0 ? totalPnl / position.riskAmount : 0,
    };
    return { position: done, balanceDelta: legPnl, closed: true };
  }
  return { position: updated, balanceDelta: legPnl, closed: false };
}

/**
 * Advance all open positions across forward candles (ascending, after fill).
 * Mutates nothing: returns the updated account.
 */
export function resolvePositions(account: PaperAccount, candles: Candle[]): PaperAccount {
  let balance = account.balance;
  const stillOpen: PaperPosition[] = [];
  const newlyClosed: ClosedTrade[] = [...account.closedTrades];

  for (const original of account.openPositions) {
    let position = original;
    let done = false;
    for (const bar of candles) {
      if (done) break;
      if (bar.closeTime <= position.openedAt) continue;
      const long = position.direction === 'long';
      const stopHit = long ? bar.low < position.stopLoss : bar.high > position.stopLoss;
      const tp1Hit = long ? bar.high > position.takeProfit1 : bar.low < position.takeProfit1;
      const tp2Hit = long ? bar.high > position.takeProfit2 : bar.low < position.takeProfit2;
      if (stopHit) {
        // Stop-first: wins over any same-bar target. Fraction 1 closes the
        // entire REMAINING size (full size, or the runner after TP1).
        const leg = closeLeg(
          position,
          1,
          position.stopLoss,
          'STOP',
          bar.closeTime,
          account.feeRate,
          account.slippageRate,
        );
        position = leg.position;
        balance += leg.balanceDelta;
        done = true;
      } else if (tp1Hit && !position.tp1Taken) {
        const leg = closeLeg(
          position,
          0.5,
          position.takeProfit1,
          'TP1',
          bar.closeTime,
          account.feeRate,
          account.slippageRate,
        );
        position = leg.position;
        balance += leg.balanceDelta;
        // Runner continues; same bar may also reach TP2 (handled next loop
        // iteration only on a LATER bar — same-bar TP1+TP2 keeps the runner
        // open rather than assuming both fills).
      } else if (tp2Hit) {
        const leg = closeLeg(
          position,
          1,
          position.takeProfit2,
          'TP2',
          bar.closeTime,
          account.feeRate,
          account.slippageRate,
        );
        position = leg.position;
        balance += leg.balanceDelta;
        done = true;
      }
    }
    if (done && position.status === 'closed') {
      newlyClosed.push(position as ClosedTrade);
    } else {
      stillOpen.push(position);
    }
  }

  return { ...account, balance, openPositions: stillOpen, closedTrades: newlyClosed };
}

/** Unrealized PnL of open positions at a mark price (display only). */
export function unrealizedPnl(position: PaperPosition, markPx: number): number {
  return pnlFor(position.direction, position.size, markPx, position.entry);
}
