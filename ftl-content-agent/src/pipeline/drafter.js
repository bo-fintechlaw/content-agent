import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { DEFAULT_SEO_KEYWORDS } from '../config/seo-keywords.js';
import { DRAFTER_SYSTEM_PROMPT, buildDrafterUserPrompt } from '../prompts/drafter-system.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 * @param {{
 *   topicId?: string,
 *   minRelevanceScore?: number
 * } | undefined} [options]
 * @description When `options.topicId` is set, drafts that topic if status is `ranked` or `revision`.
 * Otherwise uses the default queue: revision first, then highest `relevance_score` among `ranked`.
 * `minRelevanceScore` (scheduled runs only, no `topicId`): if the chosen row is `ranked` and its
 * score is below this, drafting is skipped.
 */
export async function runDrafting(supabase, config, options = {}) {
  start('runDrafting');
  try {
    const forceTopicId = String(options.topicId ?? '').trim();

    let topic;

    if (forceTopicId) {
      const { data: forced, error: forcedErr } = await supabase
        .from('content_topics')
        .select('id,title,summary,source_url,category,relevance_score,status')
        .eq('id', forceTopicId)
        .maybeSingle();
      if (forcedErr) throw new Error(forcedErr.message);
      if (!forced) return { drafted: false, reason: 'topic_not_found' };
      if (forced.status !== 'ranked' && forced.status !== 'revision') {
        return { drafted: false, reason: 'topic_not_draftable', status: forced.status };
      }
      const { data: undecided, error: undErr } = await supabase
        .from('content_drafts')
        .select('id')
        .eq('topic_id', forceTopicId)
        .is('judge_pass', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (undErr) throw new Error(undErr.message);
      if (undecided) {
        return { drafted: false, reason: 'unjudged_draft_exists', draftId: undecided.id };
      }
      topic = forced;
    } else {
      // Check for topics needing revision first (human feedback), then new ranked topics
      const { data: revisionTopic, error: revErr } = await supabase
        .from('content_topics')
        .select('id,title,summary,source_url,category,relevance_score,status')
        .eq('status', 'revision')
        .order('updated_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (revErr) throw new Error(revErr.message);

      const { data: rankedTopic, error: rankErr } = await supabase
        .from('content_topics')
        .select('id,title,summary,source_url,category,relevance_score,status')
        .eq('status', 'ranked')
        .order('relevance_score', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rankErr) throw new Error(rankErr.message);

      topic = revisionTopic || rankedTopic;
    }

    if (!topic) return { drafted: false, reason: 'no_topics_to_draft' };

    const minRel = options.minRelevanceScore;
    if (
      minRel != null &&
      Number.isFinite(minRel) &&
      !forceTopicId &&
      topic.status === 'ranked'
    ) {
      const score = Number(topic.relevance_score);
      if (!Number.isFinite(score) || score < minRel) {
        return {
          drafted: false,
          reason: 'below_minimum_relevance_score',
          relevance_score: topic.relevance_score,
          minRelevanceScore: minRel,
        };
      }
    }

    // If revising, fetch previous draft's feedback to pass as revision instructions
    // and carry forward its revision_count so the judge's per-topic cap is real.
    let revisionInstructions = [];
    let inheritedRevisionCount = 0;
    if (topic.status === 'revision') {
      const { data: prevDraft } = await supabase
        .from('content_drafts')
        .select('judge_flags, revision_count')
        .eq('topic_id', topic.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prevDraft?.judge_flags) {
        revisionInstructions = prevDraft.judge_flags
          .filter((f) => f.startsWith('human_feedback:'))
          .map((f) => f.replace('human_feedback: ', ''));
        if (!revisionInstructions.length) {
          revisionInstructions = prevDraft.judge_flags;
        }
      }
      const prevCount = Number(prevDraft?.revision_count ?? 0);
      if (Number.isFinite(prevCount) && prevCount > 0) {
        inheritedRevisionCount = prevCount;
      }
    }

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);
    let draft;
    try {
      draft = await promptJson(client, {
        model: config.ANTHROPIC_MODEL,
        system: DRAFTER_SYSTEM_PROMPT,
        user: buildDrafterUserPrompt({ topic, seoKeywords: DEFAULT_SEO_KEYWORDS, revisionInstructions }),
        maxTokens: 8000,
        temperature: 0.3,
      });
    } catch (anthropicErr) {
      const msg = String(anthropicErr?.message ?? '');
      if (
        msg.includes('anthropic_unavailable') &&
        config.DRAFTER_FALLBACK_SIMPLE_ON_ANTHROPIC_UNAVAILABLE
      ) {
        draft = buildSimpleFallbackDraft({ topic });
      } else {
        throw anthropicErr;
      }
    }

    const { data: inserted, error: insErr } = await supabase
      .from('content_drafts')
      .insert({
        topic_id: topic.id,
        blog_title: draft.blog_title,
        blog_slug: draft.blog_slug,
        blog_body: draft.blog_body,
        blog_seo_title: draft.blog_seo_title,
        blog_seo_description: draft.blog_seo_description,
        blog_seo_keywords: draft.blog_seo_keywords,
        blog_category: draft.blog_category,
        blog_tags: draft.blog_tags,
        linkedin_post: draft.linkedin_post,
        x_post: draft.x_post,
        x_thread: draft.x_thread ?? [],
        image_prompt: draft.image_prompt,
        revision_count: inheritedRevisionCount,
      })
      .select('id, topic_id, blog_title')
      .single();
    if (insErr) throw new Error(insErr.message);

    const { error: upErr } = await supabase
      .from('content_topics')
      .update({ status: 'judging', updated_at: new Date().toISOString() })
      .eq('id', topic.id);
    if (upErr) throw new Error(upErr.message);

    success('runDrafting', { draftId: inserted.id, topicId: topic.id });
    return { drafted: true, draftId: inserted.id, topicId: topic.id };
  } catch (error) {
    fail('runDrafting', error);
    throw error;
  }
}

function buildSimpleFallbackDraft({ topic }) {
  // MVP-only fallback when Anthropic is unavailable.
  // Generates a minimal, non-advice outline using existing topic metadata.
  const title = `FinTech Law Focus: ${topic.title}`;
  const slug = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const sectionBody =
    `Overview\n\n${String(topic.summary ?? '')}\n\n` +
    `Disclaimer: This draft is generated automatically and is for informational purposes only; it is not legal advice.`;

  return {
    blog_title: title,
    blog_slug: slug || `topic-${topic.id}`,
    blog_body: [
      {
        title: 'Key Takeaways',
        body: sectionBody,
        has_background: false,
      },
    ],
    blog_seo_title: title,
    blog_seo_description: String(topic.summary ?? '').slice(0, 160),
    blog_seo_keywords: Array.isArray(topic.category) ? topic.category.join(', ') : String(topic.category ?? ''),
    blog_category: topic.category ?? 'business',
    blog_tags: topic.category ? String(topic.category) : 'fintech',
    image_prompt: `Featured image for: ${topic.title}`,
    linkedin_post: `New post draft: ${topic.title}`,
    x_post: `FinTech Law Focus: ${topic.title}`,
    x_thread: [],
  };
}
