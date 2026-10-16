/**
 * Missed-scan watchdog classification (pure, tested). Thresholds are
 * observability tripwires — cron timing is never assumed:
 * - OK: latest run succeeded within STALE_MINUTES, or actively progressing.
 * - STALLED: in_progress/queued longer than STALL_MINUTES (started but stuck).
 * - WORKFLOW_ERROR: latest finished run failed/cancelled/timed out (code or
 *   API problem — read the failed step, do not blame the scheduler).
 * - CRON_GAP: latest success older than STALE_MINUTES with nothing running
 *   (GitHub delayed/dropped the schedule — dispatch manually).
 */
export interface RunInfo {
  id: number;
  status: string;
  conclusion: string | null;
  createdAt: number;
  startedAt: number;
}

export type WatchdogVerdict = 'OK' | 'STALLED' | 'WORKFLOW_ERROR' | 'CRON_GAP';

export const STALE_MINUTES = 75;
export const STALL_MINUTES = 45;

export function classifySchedule(
  runs: RunInfo[],
  now: number,
): { verdict: WatchdogVerdict; detail: string } {
  if (runs.length === 0) {
    return { verdict: 'CRON_GAP', detail: 'No scheduled runs on record — schedule may never have fired.' };
  }
  const latest = runs[0] as RunInfo;
  const ageMin = Math.max(0, Math.round((now - latest.startedAt) / 60_000));
  const active = latest.status === 'in_progress' || latest.status === 'queued';
  if (active) {
    if (ageMin > STALL_MINUTES) {
      return {
        verdict: 'STALLED',
        detail: `Run ${latest.id} ${latest.status} for ${ageMin} min (>${STALL_MINUTES}). Check the hung step in its log.`,
      };
    }
    return { verdict: 'OK', detail: `Run ${latest.id} currently ${latest.status}.` };
  }
  if (latest.conclusion === 'failure' || latest.conclusion === 'cancelled' || latest.conclusion === 'timed_out') {
    return {
      verdict: 'WORKFLOW_ERROR',
      detail: `Latest run ${latest.id} ended ${latest.conclusion}. Read its failed step — not a scheduler issue.`,
    };
  }
  if (ageMin > STALE_MINUTES) {
    return {
      verdict: 'CRON_GAP',
      detail: `Latest success is ${ageMin} min old (>${STALE_MINUTES}). Cron delayed/dropped — dispatch manually. Scan code may be healthy.`,
    };
  }
  return { verdict: 'OK', detail: `Latest run ${latest.id} ${latest.conclusion} ${ageMin} min ago.` };
}
