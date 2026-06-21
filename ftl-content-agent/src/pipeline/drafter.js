import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { getKeywordsForCategory } from '../config/seo-keywords.js';
import { getBrand, getEnabledBrands, resolveBlogCategory } from '../config/brands/index.js';
import { DRAFTER_SYSTEM_PROMPT, buildDrafterUserPrompt } from '../prompts/drafter-system.js';
import { LENS_LIST } from '../schemas/pipeline.js';
import { applyDiversityPenalty, fetchRecentlyPublished } from './diversity.js';
import { findRelatedPriorPosts } from './prior-posts.js';
import {
  renderResearchBriefForDrafter,
  runResearchSubagent,
} from './research-subagent.js';
import { findBracketLeaksInDraft } from '../utils/bracket-leak.js';
import { isRecoverablePrejudgeBlockedDraft } from './prejudge-primary.js';
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
        .select('id,title,summary,source_url,category,relevance_score,status,brand_id')
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
      const { data: blockedDraft, error: blockedErr } = await supabase
        .from('content_drafts')
        .select('id, judge_pass, judge_scores, judge_flags')
        .eq('topic_id', forceTopicId)
        .eq('judge_pass', false)
        .is('judge_scores', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (blockedErr) throw new Error(blockedErr.message);
      if (blockedDraft && isRecoverablePrejudgeBlockedDraft(blockedDraft)) {
        return {
          drafted: false,
          reason: 'prejudge_blocked_recoverable',
          draftId: blockedDraft.id,
        };
      }
      topic = forced;
    } else {
      // Check for topics needing revision first (human feedback), then new ranked topics
      const { data: revisionTopic, error: revErr } = await supabase
        .from('content_topics')
        .select('id,title,summary,source_url,category,relevance_score,status,brand_id')
        .eq('status', 'revision')
        .order('updated_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (revErr) throw new Error(revErr.message);

      // Pull a candidate set (not just the top scorer) so the diversity guard
      // can downrank PYMNTS/crypto runs and a different-source candidate at
      // slightly lower raw score wins. See diversity.js + Editorial
      // Intelligence proposal §2.1.
      let rankedTopic = null;
      if (!revisionTopic) {
        const { data: candidates, error: rankErr } = await supabase
          .from('content_topics')
          .select('id,title,summary,source_url,source_name,category,relevance_score,status,brand_id')
          .eq('status', 'ranked')
          .in(
            'brand_id',
            getEnabledBrands(config).map((b) => b.id)
          )
          .order('relevance_score', { ascending: false })
          .limit(10);
        if (rankErr) throw new Error(rankErr.message);
        if (candidates?.length) {
          const recentByBrand = new Map();
          const adjusted = candidates.map((topic) => {
            const brandId = topic.brand_id ?? 'fintechlaw';
            if (!recentByBrand.has(brandId)) {
              recentByBrand.set(brandId, null);
            }
            return topic;
          });
          for (const brandId of recentByBrand.keys()) {
            recentByBrand.set(
              brandId,
              await fetchRecentlyPublished(supabase, { brandId })
            );
          }
          const scored = adjusted.flatMap((topic) => {
            const brandId = topic.brand_id ?? 'fintechlaw';
            const recent = recentByBrand.get(brandId) ?? [];
            return applyDiversityPenalty([topic], recent);
          });
          scored.sort(
            (a, b) => b.adjustedScore - a.adjustedScore || b.rawScore - a.rawScore
          );
          rankedTopic = scored[0]?.topic ?? null;
          if (rankedTopic && scored[0].penalty > 0) {
            success('runDrafting:diversity', {
              picked: rankedTopic.id,
              rawScore: scored[0].rawScore,
              adjustedScore: scored[0].adjustedScore,
              reasons: scored[0].reasons,
              brandId: rankedTopic.brand_id,
            });
          }
        }
      }

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

    // Look up topically-related FTL posts so the drafter can cross-reference
    // its own corpus. Best-effort: empty list on any error, no blocking.
    const brandId = topic.brand_id ?? 'fintechlaw';
    const brand = getBrand(brandId);
    const relatedPriorPosts = await findRelatedPriorPosts(supabase, {
      topic,
      limit: 3,
      brandId,
    });
    if (relatedPriorPosts.length) {
      success('runDrafting:priorPosts', {
        topicId: topic.id,
        relatedCount: relatedPriorPosts.length,
        urls: relatedPriorPosts.map((p) => p.published_url),
      });
    }

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);

    // Pre-draft research subagent (item #1). Surfaces authoritative dates,
    // status, and figures so the drafter does not confabulate from stale
    // training data. Best-effort: a failure here returns an empty brief and
    // the drafter proceeds with the original prompt only.
    let researchBriefText = '';
    if (config.DISABLE_DRAFTER_RESEARCH_SUBAGENT !== 'true') {
      try {
        const brief = await runResearchSubagent(client, config, { topic });
        researchBriefText = renderResearchBriefForDrafter(brief);
      } catch (researchErr) {
        fail('runDrafting:research', researchErr, { topicId: topic.id });
      }
    }

    let draft;
    try {
      draft = await promptJson(client, {
        model: config.ANTHROPIC_MODEL,
        system: brand.prompts.drafterSystem ?? DRAFTER_SYSTEM_PROMPT,
        user: (brand.prompts.buildDrafterUser ?? buildDrafterUserPrompt)({
          topic,
          seoKeywords: getKeywordsForCategory(topic.category),
          revisionInstructions,
          relatedPriorPosts,
          researchBrief: researchBriefText,
          lensList: LENS_LIST,
        }),
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

    // Bracket-leak guard (item #2): if the drafter left placeholder strings
    // like "[insert docket number]" or "[TBD]" anywhere in the output, persist
    // them as prejudge_warning flags. The judge promotes any prejudge bracket
    // leak to a forced REVISE while revision budget remains, with the offending
    // substrings injected verbatim into the reviser feedback.
    const bracketLeaks = findBracketLeaksInDraft(draft);
    const bracketLeakFlags = bracketLeaks.map(
      (s) => `prejudge_warning: bracket_leak: ${s}`
    );

    // Journalist-discipline metadata: angle, secondary lens, and 2-5 verbatim
    // facts from the source. Stored separately in editorial_meta so the judge
    // can verify the body actually pursues the declared angle and includes
    // each declared fact. If the model omits a field, raise a prejudge_warning
    // so the judge forces a REVISE.
    const editorialMeta = buildEditorialMeta(draft);
    const editorialWarnings = validateEditorialMeta(editorialMeta);
    const editorialMetaFlags = editorialWarnings.map(
      (w) => `prejudge_warning: editorial_meta: ${w}`
    );

    draft.blog_category = resolveBlogCategory(
      brandId,
      topic.category,
      draft.blog_category
    );

    const { data: inserted, error: insErr } = await supabase
      .from('content_drafts')
      .insert({
        topic_id: topic.id,
        brand_id: brandId,
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
        judge_flags: [...bracketLeakFlags, ...editorialMetaFlags],
        editorial_meta: editorialMeta,
      })
      .select('id, topic_id, blog_title')
      .single();
    if (insErr) throw new Error(insErr.message);
    if (bracketLeaks.length) {
      success('runDrafting:bracketLeak', {
        draftId: inserted.id,
        leaks: bracketLeaks.length,
      });
    }

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
    angle: `Fallback summary of ${topic.title} (Anthropic unavailable — human review required before publish).`,
    secondary_lens: 'enforcement signal-reading',
    facts_from_source: [
      {
        fact: String(topic.summary ?? topic.title ?? '').slice(0, 400) || String(topic.title ?? 'See source URL'),
        source_url: String(topic.source_url ?? 'https://fintechlaw.ai'),
      },
    ],
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

/**
 * Extract the journalist-discipline metadata from the LLM's drafter output.
 * Returns null if none of the three fields is present, so we don't write an
 * empty object to editorial_meta. Otherwise returns a normalized object that
 * tolerates partially missing fields — validateEditorialMeta surfaces the
 * gaps as prejudge_warning flags.
 */
function buildEditorialMeta(draft) {
  const angle = typeof draft?.angle === 'string' ? draft.angle.trim() : '';
  const lens = typeof draft?.secondary_lens === 'string' ? draft.secondary_lens.trim() : '';
  const rawFacts = Array.isArray(draft?.facts_from_source) ? draft.facts_from_source : [];
  const facts = rawFacts
    .map((f) => ({
      fact: typeof f?.fact === 'string' ? f.fact.trim() : '',
      source_url: typeof f?.source_url === 'string' ? f.source_url.trim() : '',
    }))
    .filter((f) => f.fact && f.source_url);

  if (!angle && !lens && facts.length === 0) return null;
  return { angle, secondary_lens: lens, facts_from_source: facts };
}

function validateEditorialMeta(meta) {
  if (!meta) {
    return [
      'missing all editorial fields (angle, secondary_lens, facts_from_source)',
    ];
  }
  const warnings = [];
  if (!meta.angle || meta.angle.length < 20) {
    warnings.push('angle missing or shorter than 20 chars');
  }
  if (!meta.secondary_lens) {
    warnings.push('secondary_lens missing');
  }
  if (!Array.isArray(meta.facts_from_source) || meta.facts_from_source.length < 2) {
    warnings.push(
      `facts_from_source has ${meta.facts_from_source?.length ?? 0} entries; need at least 2`
    );
  }
  return warnings;
}
