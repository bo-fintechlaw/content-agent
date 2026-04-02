import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { createSlackClient, sendReviewMessage } from '../integrations/slack.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt } from '../prompts/judge-system.js';
import { fail, start, success } from '../utils/logger.js';

export async function runJudging(supabase, config) {
  start('runJudging');
  try {
    const { data: draft, error } = await supabase
      .from('content_drafts')
      .select('*')
      .is('judge_pass', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!draft) return { judged: false, reason: 'no_unjudged_drafts' };

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);
    let result;
    try {
      result = await promptJson(client, {
        model: config.ANTHROPIC_MODEL,
        system: JUDGE_SYSTEM_PROMPT,
        user: buildJudgeUserPrompt({ draft }),
        maxTokens: 2000,
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
        composite: 0,
        verdict: 'REVISE',
        revision_instructions: ['Anthropic was unavailable — re-judge when service is restored.'],
        strengths: [],
        flags: [fallbackFlag],
      };
    }

    // Normalize scores — handle both old format (number) and new format ({ score, rationale })
    const normalizedScores = {};
    for (const key of ['accuracy', 'engagement', 'seo', 'voice', 'structure']) {
      const raw = result.scores?.[key];
      normalizedScores[key] = typeof raw === 'number' ? raw : (raw?.score ?? 0);
    }

    // Also support old "tone" key mapped to "voice" for backwards compat
    if (result.scores?.tone !== undefined && result.scores?.voice === undefined) {
      const raw = result.scores.tone;
      normalizedScores.voice = typeof raw === 'number' ? raw : (raw?.score ?? 0);
    }

    const verdict = (result.verdict ?? '').toUpperCase();
    const isPassing = verdict === 'PASS';
    const isRevise = verdict === 'REVISE';

    // REVISE: send back to drafter if under revision limit (max 1 revision)
    if (isRevise && (draft.revision_count ?? 0) < 1) {
      await supabase
        .from('content_drafts')
        .update({
          revision_count: (draft.revision_count ?? 0) + 1,
          judge_scores: result.scores,
          judge_pass: false,
          judge_flags: [
            ...(result.flags ?? []),
            ...(result.revision_instructions ?? []).map((i) => `revision: ${i}`),
          ],
        })
        .eq('id', draft.id);

      await supabase
        .from('content_topics')
        .update({ status: 'revision', updated_at: new Date().toISOString() })
        .eq('id', draft.topic_id);

      success('runJudging', { draftId: draft.id, verdict, composite: result.composite, revised: true });
      return { judged: false, revised: true, draftId: draft.id, verdict, composite: result.composite };
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
        judge_flags: result.flags ?? [],
      })
      .eq('id', draft.id);

    // For passing drafts or revised drafts that exhausted revisions, send to Slack for review
    const nextTopicStatus = isPassing ? 'review' : (isRevise ? 'review' : 'rejected');
    await supabase
      .from('content_topics')
      .update({ status: nextTopicStatus, updated_at: new Date().toISOString() })
      .eq('id', draft.topic_id);

    if (sendToSlack && nextTopicStatus !== 'rejected') {
      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendReviewMessage(slack, config.SLACK_CHANNEL_ID, {
        draftId: draft.id,
        blog_title: draft.blog_title,
        scores: normalizedScores,
        composite: result.composite,
        verdict,
        blogBody: draft.blog_body,
        linkedinPost: draft.linkedin_post,
        xPost: draft.x_post,
        revisionNotes: isPassing ? null : result.revision_instructions,
      });
    }

    const isFallback = !!result?.flags?.includes('anthropic_unavailable_fallback');
    success('runJudging', { draftId: draft.id, verdict, composite: result.composite, pass: judgePass, fallback: isFallback });
    return { judged: true, draftId: draft.id, verdict, composite: result.composite, pass: judgePass, fallback: isFallback };
  } catch (error) {
    fail('runJudging', error);
    throw error;
  }
}
