import { fail, start, success } from '../utils/logger.js';
import { publishDraftToSanity } from './publisher.js';
import { runSocialPosting } from './social-poster.js';

/**
 * Stage 9: orchestration (publish to Sanity + post to LinkedIn/X).
 * Designed to run repeatedly; it is idempotent via DB flags/ids.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 */
export async function runOrchestration(supabase, config, options = {}) {
  start('runOrchestration');
  const dryRun = !!options.dryRun;
  const skipSocial = !!options.skipSocial;

  const maxPublish = config.ORCHESTRATION_MAX_PUBLISH ?? 2;

  const eligibleTopicStatuses = config.AUTO_PUBLISH_ON_REVIEW
    ? ['review', 'approved']
    : ['approved'];

  // Phase 7 publish: draft -> Sanity -> mark published.
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

  // Phase 8 social posting.
  const socialResult = skipSocial ? { skipped: true } : await runSocialPosting(supabase, config);

  success('runOrchestration', { socialResult });
  return { publishedToSanity: true, socialResult };
}

