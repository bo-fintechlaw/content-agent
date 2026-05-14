import axios from 'axios';
import { createSanityClient, createAndPublishBlogFromDraft } from '../integrations/sanity.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { recordPublishedPost } from './prior-posts.js';
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

  // Record into published_posts_index so future drafts can cross-reference
  // this one. Pull source_name + category from the topic for the index row.
  // Best-effort — recordPublishedPost swallows its own errors.
  if (published) {
    try {
      const { data: topicRow } = await supabase
        .from('content_topics')
        .select('source_name, category')
        .eq('id', draft.topic_id)
        .maybeSingle();
      await recordPublishedPost(supabase, {
        draft,
        topic: topicRow ?? {},
        publishedAt: nowIso,
        // Intentionally NOT passing config.APP_BASE_URL — that resolves to
        // the Railway API host, not the public blog. recordPublishedPost
        // defaults to fintechlaw.ai which is where the posts actually live.
      });
    } catch (indexErr) {
      fail('publishDraftToSanity:recordIndex', indexErr, { draftId });
    }
  }

  // Trigger Netlify rebuild so the new post appears on the live site.
  // Wait 10s first so apicdn.sanity.io has time to propagate the patch we
  // just committed — otherwise the build's GROQ queries can come back with
  // pre-patch state and ship a page missing the new asset.
  // See: feedback_sanity_cdn_race
  if (published && config.NETLIFY_BUILD_HOOK) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await axios.post(config.NETLIFY_BUILD_HOOK);
      success('publishDraftToSanity:netlifyRebuild', { draftId });
    } catch (netlifyErr) {
      // Non-fatal — the post is in Sanity, rebuild can be triggered manually
      fail('publishDraftToSanity:netlifyRebuild', netlifyErr);
    }
  }

  success('publishDraftToSanity', { draftId, docId });
  return { draftId, docId };
}

