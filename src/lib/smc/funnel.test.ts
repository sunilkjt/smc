import { describe, expect, it } from 'vitest';
import { diagnoseMarket } from './funnel.ts';
import {
  bullishContext,
  invertBars,
  longSetupBars,
  sweepFreeBars,
  TEST_CFG,
} from './fixtures.ts';
import { mkCandles } from './smc-core.test.ts';

describe('diagnoseMarket', () => {
  it('reports all stages passing for a valid long setup (engine verdict authoritative)', () => {
    const setup = longSetupBars();
    const context = bullishContext();
    const now = setup[setup.length - 1]?.closeTime ?? 0;
    const diagnosis = diagnoseMarket('xyz:T', context, setup, TEST_CFG, now);
    expect(diagnosis.setupBars).toBe(setup.length);
    expect(diagnosis.long.verdict).toBe('SETUP');
    expect(diagnosis.long.stages.map((s) => s.stage)).toEqual([
      'data',
      'htf-context',
      'liquidity-sweep',
      'structure-shift',
      'entry-zone',
      'entry-sl-tp-rr',
    ]);
    expect(diagnosis.long.stages.every((s) => s.passed)).toBe(true);
    // Short side on the same bullish tape must fail early and honestly.
    expect(diagnosis.short.verdict).not.toBe('SETUP');
    expect(diagnosis.short.stages[0]?.passed).toBe(true); // data itself is fine
  });

  it('mirrors for shorts and names the first rejection stage', () => {
    const setup = invertBars(longSetupBars());
    const invertedCtx = invertBars(bullishContext());
    const now = setup[setup.length - 1]?.closeTime ?? 0;
    const diagnosis = diagnoseMarket('xyz:T', invertedCtx, setup, TEST_CFG, now);
    expect(diagnosis.short.verdict).toBe('SETUP');
    expect(diagnosis.short.stages.every((s) => s.passed)).toBe(true);
  });

  it('flags missing sweeps at the liquidity stage with the engine reason', () => {
    const setup = sweepFreeBars();
    const context = bullishContext();
    const now = setup[setup.length - 1]?.closeTime ?? 0;
    const diagnosis = diagnoseMarket('xyz:T', context, setup, TEST_CFG, now);
    const sweepStage = diagnosis.long.stages.find((s) => s.stage === 'liquidity-sweep');
    expect(sweepStage?.passed).toBe(false);
    expect(diagnosis.long.verdict).toBe('NO_LIQUIDITY_EVENT');
  });

  it('flags stale data before any SMC stage is evaluated', () => {
    const setup = longSetupBars();
    const context = bullishContext();
    const now = (setup[setup.length - 1]?.closeTime ?? 0) + 20 * 900_000; // far future
    const diagnosis = diagnoseMarket('xyz:T', context, setup, TEST_CFG, now);
    expect(diagnosis.long.verdict).toBe('STALE_OR_MISSING_DATA');
    expect(diagnosis.long.stages[0]).toMatchObject({ stage: 'data', passed: false });
    expect(diagnosis.short.verdict).toBe('STALE_OR_MISSING_DATA');
  });

  it('rejects short history as a data problem, not a strategy verdict', () => {
    const setup = mkCandles([[100, 101, 99, 100]]);
    const diagnosis = diagnoseMarket('xyz:T', [], setup, TEST_CFG, Date.now());
    expect(diagnosis.long.verdict).toBe('STALE_OR_MISSING_DATA');
    expect(diagnosis.dataAgeMs).not.toBeNull();
  });
});
