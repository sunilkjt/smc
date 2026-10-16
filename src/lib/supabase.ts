/**
 * Optional Supabase persistence status. Sync is NOT implemented in this
 * phase: when env keys are present the status reports "configured (sync
 * pending)" and the app keeps working locally. Absence is reported as
 * unavailable rather than pretended. Never import service-role keys here.
 */

function readEnv(name: string): string | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    if (proc?.env?.[name]) return proc.env[name];
  } catch {
    /* ignore */
  }
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
    return meta.env?.[name];
  } catch {
    return undefined;
  }
}

export interface PersistenceStatus {
  configured: boolean;
  detail: string;
}

export function persistenceStatus(): PersistenceStatus {
  const url = readEnv('VITE_SUPABASE_URL');
  const key = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (url && key) {
    return {
      configured: true,
      detail: 'Keys present, but cloud sync is not implemented yet — running local-only.',
    };
  }
  return { configured: false, detail: 'Supabase not configured — running local-only.' };
}
