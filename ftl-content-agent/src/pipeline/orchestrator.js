import { fail, start, success } from '../utils/logger.js';
import { publishDraftToSanity } from './publisher.js';
import { runSocialPosting } from './social-poster.js';

/**
 * Lightweight orchestrator — runs every 15 min via cron.
 * Only handles publishing approved drafts and social posting.
 * Ranking, drafting, and judging run on their own schedules
 * (weekly scan+rank Monday 6AM, daily draft+judge 7AM).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 */
export async function runOrchestration(supabase, config, options = {}) {
  start('runOrchestration');
  const dryRun = !!options.dryRun;
  const skipSocial = !!options.skipSocial;

  // ── Publish approved drafts to Sanity ─────────────────────────
  const maxPublish = config.ORCHESTRATION_MAX_PUBLISH ?? 2;

  const eligibleTopicStatuses = config.AUTO_PUBLISH_ON_REVIEW
    ? ['review', 'approved']
    : ['approved'];

  const { data: topics, error: topicsErr } = await supabase
    .from('content_topics')
    .select('id,status')
    .in('status', eligibleTopicStatuses)
    .order('updated_at', { ascending: false })
    .limit(maxPublish);

  if (topicsErr) throw new Error(topicsErr.message);

  const topicIds = (topics ?? []).map((t) => t.id);
  if (topicIds.length) {
    const { data: drafts, error: draftsErr } = await supabase
      .from('content_drafts')
      .select('id,topic_id')
      .in('topic_id', topicIds)
      .eq('judge_pass', true)
      .is('sanity_document_id', null)
      .order('created_at', { ascending: true })
      .limit(maxPublish);

    if (draftsErr) throw new Error(draftsErr.message);

    if (dryRun) {
      success('runOrchestration', { dryRun: true, publishCandidates: (drafts ?? []).length });
      return { dryRun: true, publishCandidates: (drafts ?? []).length, socialResult: { skipped: true } };
    }

    for (const draft of drafts ?? []) {
      try {
        await publishDraftToSanity(supabase, config, draft.id);
      } catch (error) {
        fail('runOrchestration:publishDraft', error, { draftId: draft.id });
      }
    }
  }

  if (dryRun) {
    success('runOrchestration', { dryRun: true, publishCandidates: 0, socialCandidates: 0 });
    return { dryRun: true };
  }

  // ── Social posting ────────────────────────────────────────────
  const socialResult = skipSocial ? { skipped: true } : await runSocialPosting(supabase, config);

  success('runOrchestration', { socialResult });
  return { publishedToSanity: true, socialResult };
}
