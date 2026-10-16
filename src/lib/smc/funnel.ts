/**
 * Setup-funnel diagnostics: per-stage pass/fail counters for every market and
 * direction, WITHOUT touching the setup engine. The authoritative verdict
 * (setup vs first NO_TRADE reason) always comes from generateSetup itself;
 * the probes below reuse the same tested primitives with the same config to
 * show HOW FAR each candidate got:
 *   data → htf-context → liquidity-sweep → structure-shift → entry-zone →
 *   entry/sl/tp/rr (from the engine's own checklist).
 * Probes are informational and read-only; they never create signals and never
 * change thresholds. Used by scripts/signal-funnel.ts and unit tests.
 */
import { generateSetup } from './setup.ts';
import { analyzeStructure } from './structure.ts';
import { detectSweeps, liquidityLevels } from './liquidity.ts';
import { findSwings } from './swings.ts';
import type {
  Candle,
  EngineConfig,
  FullCoinId,
  NoTradeReason,
  SignalDirection,
} from '../types.ts';

export interface StageResult {
  stage: string;
  passed: boolean;
  detail: string;
}

export interface DirectionDiagnosis {
  direction: SignalDirection;
  stages: StageResult[];
  /** Authoritative engine verdict: 'SETUP' or the first NO_TRADE reason. */
  verdict: NoTradeReason | 'SETUP';
  verdictDetail: string;
  checksPassed: number;
  checksTotal: number;
}

export interface MarketDiagnosis {
  coin: FullCoinId;
  setupBars: number;
  contextBars: number;
  dataTime: number | null;
  dataAgeMs: number | null;
  long: DirectionDiagnosis;
  short: DirectionDiagnosis;
}

const HTF_REVERSAL_BARS = 10;

function intervalMsOf(candles: Candle[]): number {
  if (candles.length >= 2 && candles[0] && candles[1]) return candles[1].time - candles[0].time;
  return 0;
}

function diagnoseDirection(
  coin: FullCoinId,
  context: Candle[],
  setup: Candle[],
  config: EngineConfig,
  dataNow: number,
  direction: SignalDirection,
): DirectionDiagnosis {
  const stages: StageResult[] = [];
  const bullish = direction === 'long';
  const wantTrend = bullish ? 'bullish' : 'bearish';
  const wantChoch = bullish ? 'CHOCH_BULL' : 'CHOCH_BEAR';
  const wantSweepSide = bullish ? 'sellside' : 'buyside';
  const wantShift = bullish ? ['BOS_BULL', 'CHOCH_BULL'] : ['BOS_BEAR', 'CHOCH_BEAR'];

  // Authoritative verdict first (engine frozen — this IS the production path).
  const result = generateSetup({ coin, context, setup, config, dataNow }, direction);

  // Independent probes with the same primitives + config.
  const tfMs = intervalMsOf(setup);
  const lastSetup = setup[setup.length - 1];
  const dataOk =
    setup.length >= config.structureLookback + 10 &&
    context.length >= 30 &&
    lastSetup != null &&
    tfMs > 0 &&
    dataNow - lastSetup.closeTime <= 2 * tfMs;
  stages.push({
    stage: 'data',
    passed: dataOk,
    detail: dataOk
      ? `${setup.length} setup bars, ${context.length} context bars, age ${((dataNow - (lastSetup?.closeTime ?? dataNow)) / 60000).toFixed(1)}m`
      : `setup=${setup.length} (need ${config.structureLookback + 10}), context=${context.length} (need 30)`,
  });

  let htfOk = false;
  let htfDetail = 'unevaluated';
  if (context.length >= 30) {
    const ctxSwings = findSwings(context, config.swingStrength);
    const ctxState = analyzeStructure(context, ctxSwings, context.length - 1);
    const reversal = ctxState.events.some(
      (e) => e.type === wantChoch && context.length - 1 - e.index <= HTF_REVERSAL_BARS,
    );
    htfOk = ctxState.trend === wantTrend || reversal;
    htfDetail = `HTF trend ${ctxState.trend}${reversal ? ' + recent reversal' : ''}`;
  }
  stages.push({ stage: 'htf-context', passed: htfOk, detail: htfDetail });

  const end = setup.length - 1;
  const swings = setup.length > 0 ? findSwings(setup, config.swingStrength, end) : [];
  const levels = liquidityLevels(swings, end, config.equalTolerance);
  const sweeps = detectSweeps(setup, levels, end).filter((s) => s.level.side === wantSweepSide);
  const sweep = sweeps.length > 0 ? sweeps[sweeps.length - 1] : null;
  const sweepFresh = sweep != null && end - sweep.sweepIndex <= config.sweepLookback;
  stages.push({
    stage: 'liquidity-sweep',
    passed: sweepFresh,
    detail: sweep
      ? `${sweep.level.origin} swept @${sweep.sweepIndex} (${end - sweep.sweepIndex} bars ago)`
      : `no ${wantSweepSide} sweep`,
  });

  const shifts = analyzeStructure(setup, swings, end).events.filter(
    (e) => (wantShift as string[]).includes(e.type) && (sweep == null || e.index > sweep.sweepIndex),
  );
  const shift = shifts.length > 0 ? shifts[shifts.length - 1] : null;
  const shiftFresh = shift != null && end - shift.index <= config.structureLookback;
  stages.push({
    stage: 'structure-shift',
    passed: sweep != null && shiftFresh,
    detail: shift
      ? `${shift.type} @${shift.index}${sweep ? (shift.index > sweep.sweepIndex ? ' (post-sweep)' : ' (PRE-sweep, does not qualify)') : ''}`
      : 'no qualifying shift',
  });

  if (result.kind === 'setup') {
    stages.push({ stage: 'entry-zone', passed: true, detail: result.setup.zoneSources.join(' + ') });
    stages.push({
      stage: 'entry-sl-tp-rr',
      passed: true,
      detail: `entry ${result.setup.entry}, SL ${result.setup.stopLoss}, TP1 ${result.setup.takeProfit1}, RR ${result.setup.riskReward1.toFixed(2)}`,
    });
    return {
      direction,
      stages,
      verdict: 'SETUP',
      verdictDetail: result.setup.explanation,
      checksPassed: result.setup.qualityPassed,
      checksTotal: result.setup.qualityTotal,
    };
  }
  // Engine checklist items that never ran stay visible via the verdict detail.
  // The entry-zone stage is reported explicitly so every diagnosis carries
  // the same six stages (readable flags); pass/fail mirrors the engine.
  const failedCheck = result.checks.find((c) => !c.passed);
  const zoneCheck = result.checks.find((c) => c.name === 'entry-zone');
  stages.push({
    stage: 'entry-zone',
    passed: zoneCheck?.passed ?? false,
    detail: zoneCheck?.detail ?? 'not evaluated (earlier stage failed)',
  });
  stages.push({
    stage: 'entry-sl-tp-rr',
    passed: false,
    detail: failedCheck ? `${failedCheck.name}: ${failedCheck.detail}` : result.detail,
  });
  return {
    direction,
    stages,
    verdict: result.reason,
    verdictDetail: result.detail,
    checksPassed: result.checks.filter((c) => c.passed).length,
    checksTotal: result.checks.length,
  };
}

/** Full two-direction diagnosis for one market (engine untouched). */
export function diagnoseMarket(
  coin: FullCoinId,
  context: Candle[],
  setup: Candle[],
  config: EngineConfig,
  dataNow: number,
): MarketDiagnosis {
  const lastSetup = setup[setup.length - 1];
  return {
    coin,
    setupBars: setup.length,
    contextBars: context.length,
    dataTime: lastSetup?.closeTime ?? null,
    dataAgeMs: lastSetup ? dataNow - lastSetup.closeTime : null,
    long: diagnoseDirection(coin, context, setup, config, dataNow, 'long'),
    short: diagnoseDirection(coin, context, setup, config, dataNow, 'short'),
  };
}
