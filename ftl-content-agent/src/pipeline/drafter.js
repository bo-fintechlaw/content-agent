import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { DEFAULT_SEO_KEYWORDS } from '../config/seo-keywords.js';
import { DRAFTER_SYSTEM_PROMPT, buildDrafterUserPrompt } from '../prompts/drafter-system.js';
import { fail, start, success } from '../utils/logger.js';

export async function runDrafting(supabase, config) {
  start('runDrafting');
  try {
    // Check for topics needing revision first (human feedback), then new ranked topics
    const { data: revisionTopic, error: revErr } = await supabase
      .from('content_topics')
      .select('id,title,summary,category,relevance_score,status')
      .eq('status', 'revision')
      .order('updated_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (revErr) throw new Error(revErr.message);

    const { data: rankedTopic, error: rankErr } = await supabase
      .from('content_topics')
      .select('id,title,summary,category,relevance_score,status')
      .eq('status', 'ranked')
      .order('relevance_score', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rankErr) throw new Error(rankErr.message);

    const topic = revisionTopic || rankedTopic;
    if (!topic) return { drafted: false, reason: 'no_topics_to_draft' };

    // If revising, fetch previous draft's feedback to pass as revision instructions
    let revisionInstructions = [];
    if (topic.status === 'revision') {
      const { data: prevDraft } = await supabase
        .from('content_drafts')
        .select('judge_flags')
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
    }

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);
    let draft;
    try {
      draft = await promptJson(client, {
        model: config.ANTHROPIC_MODEL,
        system: DRAFTER_SYSTEM_PROMPT,
        user: buildDrafterUserPrompt({ topic, seoKeywords: DEFAULT_SEO_KEYWORDS, revisionInstructions }),
        maxTokens: 2800,
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
