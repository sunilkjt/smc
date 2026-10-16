/**
 * Missed-scan watchdog: distinguishes delayed/dropped GitHub cron events from
 * workflow errors, API failures, and stalled jobs (see lib classification).
 * Exit 0 on OK, 1 otherwise (red workflow = the alert). Needs no secrets:
 * public repo run history is readable anonymously.
 *
 * Usage: npm run watchdog
 */
import { classifySchedule, type RunInfo } from '../src/lib/ops/watchdog.ts';

interface ApiRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string;
}

function toMs(value: string | undefined, fallback: number): number {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? fallback : ms;
}

async function main(): Promise<void> {
  const repo = process.env['WATCH_REPO'] ?? 'sunilkjt/smc';
  const workflow = process.env['WATCH_WORKFLOW'] ?? 'scan.yml';
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=3`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status} (rate-limited or repo private?)`);
  const payload = (await res.json()) as { workflow_runs?: ApiRun[] };
  const runs: RunInfo[] = (payload.workflow_runs ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: toMs(r.created_at, 0),
    startedAt: toMs(r.run_started_at, toMs(r.created_at, 0)),
  }));
  const { verdict, detail } = classifySchedule(runs, Date.now());
  console.log(`WATCHDOG ${verdict}: ${detail}`);
  if (verdict !== 'OK') process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`WATCHDOG ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
