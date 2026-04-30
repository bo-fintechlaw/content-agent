import { runDrafting } from './drafter.js';
import { runJudging } from './judge.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * Draft, then immediately judge the new draft. Used by the 7 AM scheduled job
 * and by `GET /api/start-production?topicId=` (on-demand).
 *
 * - **Scheduled** (no `topicId`): same queue as `runDrafting` (revision first, then best
 *   ranked) with an optional `minRelevanceScore` floor for **ranked** rows only.
 * - **On-demand** (`topicId` set): drafts that topic (ranked or revision) if no unjudged
 *   draft exists, then judges that draft. Ignores the relevance floor.
 *
 * Publish + social are **not** run here: Slack approval, then the 15m orchestrator (or
 * `publish-now` / social) handles the rest.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 * @param {{
 *   topicId?: string,
 *   minRelevanceScore?: number,
 *   runKind?: 'scheduled' | 'on_demand',
 * } | undefined} [options]
 */
export async function runDraftAndJudge(supabase, config, options = {}) {
  const runKind = options.runKind ?? (options.topicId ? 'on_demand' : 'scheduled');
  start('runDraftAndJudge', { runKind });

  try {
    const forceTopic = String(options.topicId ?? '').trim();
    const minRel = options.minRelevanceScore;
    const minForDraft =
      forceTopic || minRel == null || !Number.isFinite(minRel) ? undefined : minRel;
    const draftResult = await runDrafting(supabase, config, {
      topicId: forceTopic || undefined,
      minRelevanceScore: minForDraft,
    });
    if (!draftResult.drafted) {
      success('runDraftAndJudge', { runKind, reason: draftResult.reason });
      return { runKind, draft: draftResult, judge: null };
    }
    if (!draftResult.draftId) {
      const err = new Error('runDrafting returned drafted without draftId');
      fail('runDraftAndJudge', err, { runKind });
      throw err;
    }
    const judgeResult = await runJudging(supabase, config, { draftId: draftResult.draftId });
    success('runDraftAndJudge', { runKind, draftId: draftResult.draftId, judged: judgeResult.judged });
    return { runKind, draft: draftResult, judge: judgeResult };
  } catch (error) {
    fail('runDraftAndJudge', error, { runKind });
    throw error;
  }
}
