import { createSanityClient, createAndPublishBlogFromDraft } from '../integrations/sanity.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('publisher');

/**
 * Stage 6a (MVP subset): publish a draft to Sanity (+ optional Agent Actions image).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ SANITY_PROJECT_ID: string, SANITY_DATASET: string, SANITY_API_TOKEN: string, SANITY_SCHEMA_ID: string }} config
 * @param {string} draftId
 */
export async function publishDraftToSanity(supabase, config, draftId, options = {}) {
  const {
    generateImage = true,
    publishAfterCreate = true,
    updateStatusToPublished = true,
  } = options;

  start('publishDraftToSanity', { draftId, options: { generateImage, publishAfterCreate, updateStatusToPublished } });

  const { data: draft, error: draftErr } = await supabase
    .from('content_drafts')
    .select('*')
    .eq('id', draftId)
    .single();
  if (draftErr) throw new Error(draftErr.message);

  const sanityClient = createSanityClient(config);

  const publishResult = await breaker.execute(
    () =>
      createAndPublishBlogFromDraft({
        client: sanityClient,
        config,
        draft,
        generateImage,
        publishAfterCreate,
      }),
  );
  if (publishResult?.error) throw new Error(String(publishResult.error));
  const { docId, published } = publishResult ?? {};
  if (!docId) throw new Error('Sanity publish did not return docId');

  const nowIso = new Date().toISOString();
  const draftUpdate = {
    sanity_document_id: docId,
  };
  if (published) draftUpdate.published_at = nowIso;

  const { error: updDraftErr } = await supabase
    .from('content_drafts')
    .update(draftUpdate)
    .eq('id', draftId);
  if (updDraftErr) throw new Error(updDraftErr.message);

  if (published && updateStatusToPublished) {
    const { error: updTopicErr } = await supabase
      .from('content_topics')
      .update({ status: 'published', updated_at: nowIso })
      .eq('id', draft.topic_id);
    if (updTopicErr) throw new Error(updTopicErr.message);
  }

  success('publishDraftToSanity', { draftId, docId });
  return { draftId, docId };
}

