import { fail } from './logger.js';

/**
 * Wrap a cron job's body so each firing produces a row in `cron_runs`.
 * Best-effort — if the DB write itself fails, we log and continue so a Supabase
 * hiccup never silently kills a cron tick.
 *
 * Usage:
 *   await withCronRun(supabase, 'cron:dailyContent', async () => {
 *     return await runDraftAndJudge(...);
 *   });
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} name
 * @param {() => Promise<any>} fn
 */
export async function withCronRun(supabase, name, fn) {
  const startedAt = new Date();
  let runId = null;

  try {
    const { data, error } = await supabase
      .from('cron_runs')
      .insert({ cron_name: name, status: 'started', started_at: startedAt.toISOString() })
      .select('id')
      .maybeSingle();
    if (!error && data?.id) runId = data.id;
  } catch (e) {
    fail('withCronRun:insert', e, { name });
  }

  try {
    const result = await fn();
    const finishedAt = new Date();
    if (runId) {
      try {
        await supabase
          .from('cron_runs')
          .update({
            status: 'success',
            finished_at: finishedAt.toISOString(),
            duration_ms: finishedAt.getTime() - startedAt.getTime(),
            summary: serializeSummary(result),
          })
          .eq('id', runId);
      } catch (e) {
        fail('withCronRun:successUpdate', e, { name, runId });
      }
    }
    return result;
  } catch (err) {
    const finishedAt = new Date();
    if (runId) {
      try {
        await supabase
          .from('cron_runs')
          .update({
            status: 'failed',
            finished_at: finishedAt.toISOString(),
            duration_ms: finishedAt.getTime() - startedAt.getTime(),
            error_message: String(err?.message ?? err).slice(0, 2_000),
          })
          .eq('id', runId);
      } catch (e) {
        fail('withCronRun:failUpdate', e, { name, runId });
      }
    }
    throw err;
  }
}

function serializeSummary(result) {
  if (result == null) return null;
  try {
    // Strip likely-huge fields so the summary stays scannable in the dashboard.
    const out = JSON.parse(JSON.stringify(result));
    pruneLargeFields(out);
    return out;
  } catch {
    return { _serialization: 'failed', type: typeof result };
  }
}

function pruneLargeFields(obj, depth = 0) {
  if (depth > 4 || obj == null || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 500) {
      obj[key] = `${v.slice(0, 500)}…[truncated]`;
    } else if (Array.isArray(v) && v.length > 10) {
      obj[key] = [...v.slice(0, 10), `…[${v.length - 10} more]`];
    } else if (v && typeof v === 'object') {
      pruneLargeFields(v, depth + 1);
    }
  }
}
