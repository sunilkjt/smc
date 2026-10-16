/**
 * Multi-timeframe SMC setup generation with defined entry, stop and targets.
 *
 * Baseline long rules (short mirrors exactly):
 *  1. Fresh, sufficient closed-candle data on setup + context series.
 *  2. Higher-timeframe context: bullish trend, or a bullish CHoCH within the
 *     last 10 context bars (explicitly permitted reversal).
 *  3. A sell-side liquidity sweep on the setup TF within `sweepLookback` bars
 *     of the series end (wick through + close back — touch alone never counts).
 *  4. A bullish structure shift (BOS or CHoCH) on the setup TF AFTER the sweep.
 *  5. An aligned bullish FVG and/or order block (open or partially filled,
 *     fresh, positioned for a retracement below the confirmation close).
 *     The entry zone is the overlap when both agree, else the freshest one.
 *  6. Entry trigger: limit order at the zone edge nearest the market
 *     (conservative fill; a touch does not guarantee a fill — see paper).
 *  7. Structural stop: beyond the sweep extreme minus `atrStopBuffer`×ATR,
 *     strictly below the entry zone (a stop inside the zone is rejected).
 *  8. TP1/TP2: nearest REMAINING opposing (buy-side) liquidity levels above
 *     entry. The level consumed by the confirming break itself (`shift.level`)
 *     is excluded — the break filled that liquidity, so targets aim at what
 *     is left. TP1 must clear `minTargetAtrMultiple`×ATR and RR(TP1) ≥
 *     `minRiskReward`.
 *
 * Any failure returns NO_TRADE with a machine-readable reason plus the
 * transparent pass/fail checklist. Exceptions are documented here, never
 * applied silently: the ONLY permitted HTF exception is the recent-CHoCH
 * reversal above; everything else is mandatory.
 */
import {
  alignedEntryBlocks,
  orderBlockForBreak,
  resolveOrderBlock,
} from './orderblocks.ts';
import { alignedEntryGaps, detectFvgs } from './fvg.ts';
import { detectSweeps, liquidityLevels } from './liquidity.ts';
import { analyzeStructure } from './structure.ts';
import { findSwings } from './swings.ts';
import { atr } from './atr.ts';
import type {
  Candle,
  EngineConfig,
  FullCoinId,
  LiquidityLevel,
  NoTradeReason,
  SetupCondition,
  SignalDirection,
  SmcSetup,
} from '../types.ts';

export interface SetupInputs {
  coin: FullCoinId;
  /** Closed context-TF candles (e.g. 1h), ascending. */
  context: Candle[];
  /** Closed setup-TF candles (e.g. 15m), ascending. */
  setup: Candle[];
  config: EngineConfig;
  /** Wall-clock used only for data-freshness (never for pattern logic). */
  dataNow: number;
}

export type SetupResult =
  | { kind: 'setup'; setup: SmcSetup }
  | { kind: 'no-trade'; reason: NoTradeReason; detail: string; checks: SetupCondition[] };

const HTF_REVERSAL_BARS = 10;

function check(name: string, passed: boolean, detail: string): SetupCondition {
  return { name, passed, detail };
}

function intervalMsOf(candles: Candle[]): number {
  if (candles.length >= 2 && candles[0] && candles[1]) {
    return candles[1].time - candles[0].time;
  }
  return 0;
}

export function generateSetup(inputs: SetupInputs, direction: SignalDirection): SetupResult {
  const { coin, context, setup, config, dataNow } = inputs;
  const checks: SetupCondition[] = [];
  const noTrade = (
    reason: NoTradeReason,
    detail: string,
  ): SetupResult => ({ kind: 'no-trade', reason, detail, checks });

  const bullish = direction === 'long';
  const wantTrend = bullish ? 'bullish' : 'bearish';
  const wantShift: Array<'BOS_BULL' | 'CHOCH_BULL' | 'BOS_BEAR' | 'CHOCH_BEAR'> = bullish
    ? ['BOS_BULL', 'CHOCH_BULL']
    : ['BOS_BEAR', 'CHOCH_BEAR'];
  const wantSweepSide = bullish ? 'sellside' : 'buyside';
  const wantZone = bullish ? 'bullish' : 'bearish';
  const wantChoch = bullish ? 'CHOCH_BULL' : 'CHOCH_BEAR';

  // 1. Data sufficiency + freshness (setup TF drives timing).
  const tfMs = intervalMsOf(setup);
  const lastSetup = setup[setup.length - 1];
  if (
    setup.length < config.structureLookback + 10 ||
    context.length < 30 ||
    !lastSetup ||
    tfMs <= 0
  ) {
    checks.push(check('data', false, 'insufficient closed-candle history'));
    return noTrade('STALE_OR_MISSING_DATA', 'Not enough confirmed history to evaluate structure.');
  }
  const dataTime = lastSetup.closeTime;
  if (dataNow - dataTime > 2 * tfMs) {
    checks.push(check('data', false, `last close ${new Date(dataTime).toISOString()} is stale`));
    return noTrade('STALE_OR_MISSING_DATA', 'Latest setup candle is stale; no signal on old data.');
  }
  checks.push(check('data', true, `${setup.length} setup bars, ${context.length} context bars`));

  const end = setup.length - 1;
  const refClose = lastSetup.close;

  // 2. Higher-timeframe context.
  const ctxSwings = findSwings(context, config.swingStrength);
  const ctxState = analyzeStructure(context, ctxSwings, context.length - 1);
  const recentReversal = ctxState.events.some(
    (e) => e.type === wantChoch && context.length - 1 - e.index <= HTF_REVERSAL_BARS,
  );
  const contextOk = ctxState.trend === wantTrend || recentReversal;
  checks.push(
    check(
      'htf-context',
      contextOk,
      `HTF trend ${ctxState.trend}${recentReversal ? ' + recent reversal CHoCH' : ''}`,
    ),
  );
  if (!contextOk) {
    return noTrade(
      'NO_HTF_CONTEXT',
      `Higher-timeframe trend is ${ctxState.trend} with no permitted reversal; ${direction} blocked.`,
    );
  }

  // 3. Liquidity event on the setup TF (recent sweep of the correct side).
  const swings = findSwings(setup, config.swingStrength, end);
  const levels = liquidityLevels(swings, end, config.equalTolerance);
  const sweeps = detectSweeps(setup, levels, end).filter((s) => s.level.side === wantSweepSide);
  const sweep = sweeps.length > 0 ? sweeps[sweeps.length - 1] : null;
  const sweepFresh = sweep != null && end - sweep.sweepIndex <= config.sweepLookback;
  checks.push(
    check(
      'liquidity-sweep',
      sweepFresh,
      sweep
        ? `${sweep.level.origin} swept @ bar ${sweep.sweepIndex} (${end - sweep.sweepIndex} bars ago)`
        : `no ${wantSweepSide} sweep in series`,
    ),
  );
  if (!sweep || !sweepFresh) {
    return noTrade(
      'NO_LIQUIDITY_EVENT',
      `No fresh ${wantSweepSide} liquidity sweep (lookback ${config.sweepLookback} bars).`,
    );
  }

  // 4. Structure shift AFTER the sweep.
  const postSweepEvents = analyzeStructure(setup, swings, end).events.filter(
    (e) => wantShift.includes(e.type) && e.index > sweep.sweepIndex,
  );
  const shift = postSweepEvents.length > 0 ? postSweepEvents[postSweepEvents.length - 1] : null;
  const shiftFresh = shift != null && end - shift.index <= config.structureLookback;
  checks.push(
    check(
      'structure-shift',
      shiftFresh,
      shift ? `${shift.type} @ bar ${shift.index} through ${shift.level}` : 'no post-sweep shift',
    ),
  );
  if (!shift || !shiftFresh) {
    return noTrade(
      'NO_STRUCTURE_SHIFT',
      'No confirmed post-sweep structure shift on the setup timeframe.',
    );
  }
  const setupIndex = shift.index;

  // 5. Aligned entry zone (FVG and/or order block), evaluated AS OF the shift
  //    bar so later bars can never donate a zone (no look-ahead).
  const gaps = detectFvgs(setup, setupIndex);
  const zoneGaps = alignedEntryGaps(
    gaps,
    wantZone,
    setup[setupIndex]?.close ?? refClose,
    setupIndex,
    config.fvgLookback,
  );
  const block = orderBlockForBreak(setup, shift, config.swingStrength * 5 + 5);
  let zoneBlocks: typeof block[] = [];
  if (block) {
    resolveOrderBlock(setup, block, setupIndex);
    zoneBlocks = alignedEntryBlocks(
      [block],
      wantZone,
      setup[setupIndex]?.close ?? refClose,
      setupIndex,
      config.fvgLookback,
    );
  }
  const gap = zoneGaps.length > 0 ? zoneGaps[zoneGaps.length - 1] : null;
  const ob = zoneBlocks.length > 0 ? zoneBlocks[zoneBlocks.length - 1] : null;
  const sources: string[] = [];
  if (gap) sources.push(`${wantZone}-FVG@${gap.createdIndex}`);
  if (ob) sources.push(`${wantZone}-OB@${ob.index}`);

  let zoneTop = 0;
  let zoneBottom = 0;
  if (gap && ob) {
    // Overlap when both agree; otherwise the freshest single zone wins.
    const top = Math.min(gap.top, ob.top);
    const bottom = Math.max(gap.bottom, ob.bottom);
    if (bottom < top) {
      zoneTop = top;
      zoneBottom = bottom;
    } else if (gap.createdIndex >= ob.breakIndex) {
      zoneTop = gap.top;
      zoneBottom = gap.bottom;
    } else {
      zoneTop = ob.top;
      zoneBottom = ob.bottom;
    }
  } else if (gap) {
    zoneTop = gap.top;
    zoneBottom = gap.bottom;
  } else if (ob) {
    zoneTop = ob.top;
    zoneBottom = ob.bottom;
  }
  const hasZone = sources.length > 0;
  checks.push(
    check('entry-zone', hasZone, hasZone ? sources.join(' + ') : 'no aligned FVG or order block'),
  );
  if (!hasZone) {
    return noTrade('NO_ENTRY_ZONE', 'Confirmed shift has no aligned FVG or order-block entry zone.');
  }

  // Entry trigger: conservative limit at the zone edge nearest the market.
  const shiftClose = setup[setupIndex]?.close ?? refClose;
  const entry = bullish ? zoneTop : zoneBottom;
  const entryOk = bullish ? shiftClose > zoneTop : shiftClose < zoneBottom;
  checks.push(
    check('entry-valid', entryOk, `limit ${entry} vs confirmation close ${shiftClose}`),
  );
  if (!entryOk) {
    return noTrade(
      'ENTRY_INVALIDATED',
      'Price is already inside/beyond the zone — the retracement edge is gone.',
    );
  }

  // 7. Structural stop beyond the sweep extreme + ATR buffer, below the zone.
  const atrValue = atr(setup, config.atrPeriod, setupIndex);
  const extreme = sweep.extreme;
  const stopLoss = bullish
    ? extreme - config.atrStopBuffer * atrValue
    : extreme + config.atrStopBuffer * atrValue;
  const stopOk =
    Number.isFinite(stopLoss) &&
    atrValue > 0 &&
    (bullish ? stopLoss < zoneBottom && stopLoss < entry : stopLoss > zoneTop && stopLoss > entry);
  checks.push(
    check(
      'stop-valid',
      stopOk,
      `SL ${stopLoss} beyond sweep ${extreme} + ${config.atrStopBuffer}×ATR(${atrValue})`,
    ),
  );
  if (!stopOk) {
    return noTrade('STOP_INVALID', 'Stop is not structurally valid (inside zone/entry or bad ATR).');
  }

  // 8. Opposing-liquidity targets above entry (long) / below (short),
  // excluding the level consumed by the confirming break itself.
  const brokenTol = Math.abs(shift.level) * config.equalTolerance + 1e-9;
  const wantTargetSide = bullish ? 'buyside' : 'sellside';
  const targets = levels
    .filter(
      (l) =>
        l.side === wantTargetSide &&
        Math.abs(l.price - shift.level) > brokenTol &&
        (bullish ? l.price > entry : l.price < entry),
    )
    .map((l) => l.price)
    .sort((a, b) => (bullish ? a - b : b - a));
  const tp1 = targets[0];
  const tp2 = targets[1] ?? (tp1 != null ? (bullish ? tp1 + (tp1 - entry) : tp1 - (entry - tp1)) : null);
  const risk = Math.abs(entry - stopLoss);
  const tp1Dist = tp1 != null ? Math.abs(tp1 - entry) : 0;
  const targetOk =
    tp1 != null &&
    tp2 != null &&
    tp1Dist >= config.minTargetAtrMultiple * atrValue;
  checks.push(
    check(
      'target-valid',
      targetOk,
      tp1 != null ? `TP1 ${tp1} (${tp1Dist} vs min ${config.minTargetAtrMultiple}×ATR)` : 'no opposing liquidity',
    ),
  );
  if (!targetOk) {
    return noTrade('TARGET_TOO_CLOSE', 'No sufficiently distant opposing-liquidity target.');
  }

  const riskReward1 = tp1Dist / risk;
  const riskReward2 = Math.abs((tp2 as number) - entry) / risk;
  const rrOk = riskReward1 >= config.minRiskReward;
  checks.push(
    check('risk-reward', rrOk, `RR ${riskReward1.toFixed(2)} vs minimum ${config.minRiskReward}`),
  );
  if (!rrOk) {
    return noTrade(
      'RR_TOO_LOW',
      `Risk/reward ${riskReward1.toFixed(2)} below minimum ${config.minRiskReward}.`,
    );
  }

  const qualityPassed = checks.filter((c) => c.passed).length;
  const explanation =
    direction === 'long'
      ? `HTF ${ctxState.trend}${recentReversal ? ' with reversal' : ''}; sell-side swept @${sweep.level.origin}, ` +
        `bullish ${shift.type} @ bar ${shift.index}; limit ${entry} in ${sources.join(' + ')}, ` +
        `SL ${stopLoss}, TP1 ${tp1}, TP2 ${tp2} (RR ${riskReward1.toFixed(2)}/${riskReward2.toFixed(2)}).`
      : `HTF ${ctxState.trend}${recentReversal ? ' with reversal' : ''}; buy-side swept @${sweep.level.origin}, ` +
        `bearish ${shift.type} @ bar ${shift.index}; limit ${entry} in ${sources.join(' + ')}, ` +
        `SL ${stopLoss}, TP1 ${tp1}, TP2 ${tp2} (RR ${riskReward1.toFixed(2)}/${riskReward2.toFixed(2)}).`;

  const setupBar = setup[setupIndex];
  const setupOut: SmcSetup = {
    coin,
    contextTimeframe: context.length > 1 && context[0] && context[1]
      ? intervalLabel(context[1].time - context[0].time)
      : '1h',
    setupTimeframe: intervalLabel(tfMs),
    entryTimeframe: config.entryTimeframe,
    direction,
    entry,
    entryZoneTop: zoneTop,
    entryZoneBottom: zoneBottom,
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: tp2 as number,
    riskReward1,
    riskReward2,
    setupIndex,
    signalTime: setupBar?.closeTime ?? dataTime,
    dataTime,
    conditions: checks,
    qualityPassed,
    qualityTotal: checks.length,
    explanation,
    zoneSources: sources,
  };
  return { kind: 'setup', setup: setupOut };
}

function intervalLabel(ms: number): SmcSetup['setupTimeframe'] {
  const table: Array<[number, SmcSetup['setupTimeframe']]> = [
    [60_000, '1m'],
    [180_000, '3m'],
    [300_000, '5m'],
    [900_000, '15m'],
    [1_800_000, '30m'],
    [3_600_000, '1h'],
    [7_200_000, '2h'],
    [14_400_000, '4h'],
    [28_800_000, '8h'],
    [43_200_000, '12h'],
    [86_400_000, '1d'],
    [259_200_000, '3d'],
    [604_800_000, '1w'],
  ];
  for (const [step, label] of table) if (ms <= step * 1.5 && ms >= step * 0.5) return label;
  return '15m';
}

export function opposingLevels(levels: LiquidityLevel[], side: 'buyside' | 'sellside'): number[] {
  return levels.filter((l) => l.side === side).map((l) => l.price);
}
