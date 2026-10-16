import { describe, expect, it } from 'vitest';
import { classifySchedule, type RunInfo } from './watchdog.ts';

function run(overrides: Partial<RunInfo>): RunInfo {
  return {
    id: 1, status: 'completed', conclusion: 'success', createdAt: 0, startedAt: 0, ...overrides,
  };
}

const NOW = 10_000_000;

describe('classifySchedule', () => {
  it('is OK on a recent successful run', () => {
    expect(classifySchedule([run({ startedAt: NOW - 30 * 60_000 })], NOW).verdict).toBe('OK');
  });

  it('flags stale success as a cron gap (delayed/dropped schedule, not an error)', () => {
    const out = classifySchedule([run({ startedAt: NOW - 120 * 60_000 })], NOW);
    expect(out.verdict).toBe('CRON_GAP');
    expect(out.detail).toContain('75');
  });

  it('flags recent failures as workflow errors (distinct from gaps)', () => {
    const out = classifySchedule(
      [run({ status: 'completed', conclusion: 'failure', startedAt: NOW - 10 * 60_000 })],
      NOW,
    );
    expect(out.verdict).toBe('WORKFLOW_ERROR');
  });

  it('flags long-running active runs as stalled', () => {
    const out = classifySchedule([run({ status: 'in_progress', conclusion: null, startedAt: NOW - 50 * 60_000 })], NOW);
    expect(out.verdict).toBe('STALLED');
    const fresh = classifySchedule(
      [run({ status: 'in_progress', conclusion: null, startedAt: NOW - 5 * 60_000 })],
      NOW,
    );
    expect(fresh.verdict).toBe('OK');
  });

  it('handles empty history without crashing', () => {
    expect(classifySchedule([], NOW).verdict).toBe('CRON_GAP');
  });
});
