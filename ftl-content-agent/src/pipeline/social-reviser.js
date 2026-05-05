import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { fail, start, success } from '../utils/logger.js';

const SOCIAL_REVISION_SYSTEM = `You are Bo Howell, Managing Director of FinTech Law (fintechlaw.ai). You are revising social media posts based on a single piece of human reviewer feedback.

CRITICAL RULES — these override everything else:
- Make ONLY the change(s) the feedback requests. Do not rewrite, rephrase, or restructure anything the feedback does not address.
- Posts unaffected by the feedback MUST be returned verbatim — byte-for-byte identical to the input, including punctuation, line breaks, emojis, arrow bullets (→), separator lines (↓), hashtags, and CTA URLs.
- Do not strip emojis, arrow bullets (→), separator lines (↓), hashtags, blank lines, or any formatting unless the feedback explicitly asks you to.
- Do not "improve" wording or swap synonyms in passages the feedback does not call out.

Voice rules to maintain in any sentences you do change:
- No contractions ("is not", "does not", "cannot", "will not").
- Never fabricate personal experiences ("a client asked me", "in my conversations with"). Cite published data and public sources only.

Return strict JSON only — no markdown fences, no commentary outside the JSON object.`;

/**
 * Regenerate social posts for an existing draft using feedback.
 * Updates the draft in the DB and returns the new content.
 */
export async function reviseSocialContent(supabase, config, draftId, feedback) {
  start('reviseSocialContent');

  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('id, blog_title, blog_slug, linkedin_post, x_post, x_thread')
    .eq('id', draftId)
    .single();
  if (error) throw new Error(error.message);

  const client = createAnthropicClient(config.ANTHROPIC_API_KEY);

  const result = await promptJson(client, {
    model: config.ANTHROPIC_MODEL,
    system: SOCIAL_REVISION_SYSTEM,
    user: `Revise the social posts below based on the reviewer feedback. Change ONLY what the feedback addresses; leave every other element verbatim, including emojis, arrow bullets (→), separator lines (↓), hashtags, blank lines, and CTA URLs.

Blog title: "${draft.blog_title}"
Blog URL (use this verbatim if a CTA URL needs updating): https://fintechlaw.ai/blog/${draft.blog_slug}

CURRENT LINKEDIN POST
=====================
${draft.linkedin_post ?? '(none)'}

CURRENT X POST
==============
${draft.x_post ?? '(none)'}

CURRENT X THREAD
================
${JSON.stringify(draft.x_thread ?? [], null, 2)}

REVIEWER FEEDBACK
=================
${feedback}

Return JSON with this exact structure:
{
  "linkedin_post": "the LinkedIn post — return unchanged unless the feedback addresses it",
  "x_post": "the tweet — return unchanged unless the feedback addresses it",
  "x_thread": ["tweet 1", "tweet 2", "..."]
}

Requirements:
- Preserve emojis, arrow bullets (→), separator lines (↓), hashtags, blank lines, and existing CTA URLs from the input. Do not strip or rewrite them.
- For any post the feedback does not address, return it byte-for-byte identical to the input.
- JSON only — no text outside the JSON object.`,
    maxTokens: 2000,
    temperature: 0.1,
  });

  // Update draft with revised social content
  await supabase
    .from('content_drafts')
    .update({
      linkedin_post: result.linkedin_post ?? draft.linkedin_post,
      x_post: result.x_post ?? draft.x_post,
      x_thread: result.x_thread ?? draft.x_thread,
      social_approved: null, // reset approval for re-review
    })
    .eq('id', draftId);

  success('reviseSocialContent', { draftId });
  return {
    blogTitle: draft.blog_title,
    linkedinPost: result.linkedin_post ?? draft.linkedin_post,
    xPost: result.x_post ?? draft.x_post,
    xThread: result.x_thread ?? draft.x_thread,
  };
}
