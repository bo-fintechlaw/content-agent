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
      // If Anthropic is unavailable, do NOT auto-pass. Mark as failed so it can be retried later.
      const fallbackFlag = 'anthropic_unavailable_fallback';
      const defaultScores = { accuracy: 0, engagement: 0, seo: 0, voice: 0, tone: 0 };
      result = {
        scores: defaultScores,
        pass: false,
        revision_instructions: ['Anthropic was unavailable — re-judge when service is restored.'],
        flags: [fallbackFlag],
      };
    }

    const needsRevise = !result.pass && (draft.revision_count ?? 0) < 2;
    if (needsRevise) {
      // Store the judge feedback on the current draft
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
      // Set topic to 'revision' so the drafter picks it up and rewrites using the feedback
      await supabase
        .from('content_topics')
        .update({ status: 'revision', updated_at: new Date().toISOString() })
        .eq('id', draft.topic_id);
      return { judged: false, revised: true, draftId: draft.id };
    }

    await supabase
      .from('content_drafts')
      .update({
        judge_scores: result.scores,
        judge_pass: !!result.pass,
        judge_flags: result.flags ?? [],
      })
      .eq('id', draft.id);

    const nextTopicStatus = result.pass ? 'review' : 'rejected';
    await supabase
      .from('content_topics')
      .update({ status: nextTopicStatus, updated_at: new Date().toISOString() })
      .eq('id', draft.topic_id);

    if (result.pass) {
      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendReviewMessage(slack, config.SLACK_CHANNEL_ID, {
        draftId: draft.id,
        blog_title: draft.blog_title,
        scores: result.scores,
        blogBody: draft.blog_body,
        linkedinPost: draft.linkedin_post,
        xPost: draft.x_post,
      });
    }

    const isFallback = !!result?.flags?.includes('anthropic_unavailable_fallback');
    success('runJudging', { draftId: draft.id, pass: !!result.pass, fallback: isFallback });
    return { judged: true, draftId: draft.id, pass: !!result.pass, fallback: isFallback };
  } catch (error) {
    fail('runJudging', error);
    throw error;
  }
}
