import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { createSlackClient, sendReviewMessage } from '../integrations/slack.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt } from '../prompts/judge-system.js';
import { extractHttpUrlsFromDraft, fetchAllCitationPreviews } from './citation-harvest.js';
import { runCitationVerificationSubagent } from './citation-subagent.js';
import {
  computeJudgeComposite,
  deriveJudgeVerdict,
  normalizeJudgeScores,
} from './verdict.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 * @param {{ draftId?: string } | undefined} [options]
 * @description When `options.draftId` is set, judges only that row if it is not yet judged.
 * Otherwise picks the oldest unjudged draft.
 */
export async function runJudging(supabase, config, options = {}) {
  start('runJudging');
  try {
    const forceDraftId = String(options.draftId ?? '').trim();
    let draft;
    if (forceDraftId) {
      const { data: d, error: dErr } = await supabase
        .from('content_drafts')
        .select('*')
        .eq('id', forceDraftId)
        .maybeSingle();
      if (dErr) throw new Error(dErr.message);
      if (!d) return { judged: false, reason: 'draft_not_found' };
      if (d.judge_pass != null) {
        return { judged: false, reason: 'already_judged', pass: d.judge_pass, draftId: d.id };
      }
      draft = d;
    } else {
      const { data, error } = await supabase
        .from('content_drafts')
        .select('*')
        .is('judge_pass', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { judged: false, reason: 'no_unjudged_drafts' };
      draft = data;
    }

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);

    const citedUrls = extractHttpUrlsFromDraft(draft);
    const linkFetches = await fetchAllCitationPreviews(citedUrls);
    const subagent = await runCitationVerificationSubagent(client, config, {
      draft,
      fetches: linkFetches,
    });
    const linkContext = { fetches: linkFetches, subagent };

    let result;
    try {
      result = await promptJson(client, {
        model: config.ANTHROPIC_MODEL,
        system: JUDGE_SYSTEM_PROMPT,
        user: buildJudgeUserPrompt({ draft, linkContext }),
        maxTokens: 3_200,
        temperature: 0.1,
      });
    } catch (anthropicErr) {
      const fallbackFlag = 'anthropic_unavailable_fallback';
      result = {
        scores: {
          accuracy: { score: 0, rationale: 'Anthropic unavailable' },
          engagement: { score: 0, rationale: 'Anthropic unavailable' },
          seo: { score: 0, rationale: 'Anthropic unavailable' },
          voice: { score: 0, rationale: 'Anthropic unavailable' },
          structure: { score: 0, rationale: 'Anthropic unavailable' },
        },
        revision_instructions: ['Anthropic was unavailable — re-judge when service is restored.'],
        strengths: [],
        flags: [fallbackFlag],
      };
    }

    // Composite + verdict are computed in code (single source of truth in verdict.js).
    // Any composite/verdict the LLM happens to return is ignored.
    const normalizedScores = normalizeJudgeScores(result.scores);
    const composite = computeJudgeComposite(normalizedScores);
    const verdict = deriveJudgeVerdict({ composite, scores: normalizedScores });
    const isPassing = verdict === 'PASS';
    const isRevise = verdict === 'REVISE';

    // Pull any prejudge warnings (e.g. paywalled sources) that runPreJudgeQualityChecks
    // persisted on judge_flags before this judge call. Preserve them across the
    // upcoming judge_flags overwrite so the Slack review message can surface them.
    const prejudgeWarnings = (Array.isArray(draft.judge_flags) ? draft.judge_flags : [])
      .filter((f) => typeof f === 'string' && f.startsWith('prejudge_warning:'));
    const manualVerificationNotes = prejudgeWarnings.map((w) =>
      w.replace(/^prejudge_warning:\s*/, '').trim()
    );

    // REVISE: send back to drafter if under revision limit (max 1 revision)
    if (isRevise && (draft.revision_count ?? 0) < 1) {
      await supabase
        .from('content_drafts')
        .update({
          revision_count: (draft.revision_count ?? 0) + 1,
          judge_scores: result.scores,
          judge_pass: false,
          judge_flags: [
            ...prejudgeWarnings,
            ...(result.flags ?? []),
            ...(result.revision_instructions ?? []).map((i) => `revision: ${i}`),
          ],
        })
        .eq('id', draft.id);

      await supabase
        .from('content_topics')
        .update({ status: 'revision', updated_at: new Date().toISOString() })
        .eq('id', draft.topic_id);

      success('runJudging', { draftId: draft.id, verdict, composite, revised: true });
      return { judged: false, revised: true, draftId: draft.id, verdict, composite };
    }

    // PASS, or REVISE that already used its revision — send to Slack
    // REJECT with no revisions left — also send to Slack with notes
    const sendToSlack = isPassing || isRevise || verdict === 'REJECT';
    const judgePass = isPassing;

    await supabase
      .from('content_drafts')
      .update({
        judge_scores: result.scores,
        judge_pass: judgePass,
        judge_flags: [...prejudgeWarnings, ...(result.flags ?? [])],
      })
      .eq('id', draft.id);

    // For passing drafts or revised drafts that exhausted revisions, send to Slack for review
    const nextTopicStatus = isPassing ? 'review' : (isRevise ? 'review' : 'rejected');
    await supabase
      .from('content_topics')
      .update({ status: nextTopicStatus, updated_at: new Date().toISOString() })
      .eq('id', draft.topic_id);

    if (sendToSlack && nextTopicStatus !== 'rejected') {
      const baseUrl = String(config.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
      const reviewUrl = baseUrl ? `${baseUrl}/api/drafts/${draft.id}/preview` : '';
      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendReviewMessage(slack, config.SLACK_CHANNEL_ID, {
        draftId: draft.id,
        blog_title: draft.blog_title,
        scores: normalizedScores,
        composite,
        verdict,
        blogBody: draft.blog_body,
        linkedinPost: draft.linkedin_post,
        xPost: draft.x_post,
        revisionNotes: isPassing ? null : result.revision_instructions,
        manualVerificationNotes,
        reviewUrl,
      });
    }

    const isFallback = !!result?.flags?.includes('anthropic_unavailable_fallback');
    success('runJudging', { draftId: draft.id, verdict, composite, pass: judgePass, fallback: isFallback });
    return { judged: true, draftId: draft.id, verdict, composite, pass: judgePass, fallback: isFallback };
  } catch (error) {
    fail('runJudging', error);
    throw error;
  }
}
