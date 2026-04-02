import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { fail, start, success } from '../utils/logger.js';

const SOCIAL_REVISION_SYSTEM = `You are Bo Howell, Managing Director of FinTech Law (fintechlaw.ai). Revise social media posts based on human feedback.

Rules:
- No contractions ("is not" not "isn't")
- NEVER fabricate personal experiences ("every founder I talked to", "a client asked me", "in my conversations with"). You are an AI — cite data and public sources only.
- LinkedIn: Professional but conversational. 100-200 words. Hook first line. End with CTA to the blog post.
- X post: Under 280 characters. Most surprising or important fact.
- X thread: 3-4 tweets. Each stands alone. End with CTA linking to blog.
- No emojis.

Return strict JSON only.`;

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
    user: `Revise the social media posts for this blog: "${draft.blog_title}"

Current LinkedIn post:
${draft.linkedin_post ?? '(none)'}

Current X post:
${draft.x_post ?? '(none)'}

Current X thread:
${JSON.stringify(draft.x_thread ?? [], null, 2)}

FEEDBACK FROM REVIEWER:
${feedback}

Return JSON:
{
  "linkedin_post": "Revised LinkedIn post (100-200 words, hook first line, end with CTA)",
  "x_post": "Revised tweet under 280 chars",
  "x_thread": ["Tweet 1", "Tweet 2", "Tweet 3", "Tweet 4 (CTA)"]
}

Blog URL for CTAs: https://fintechlaw.ai/blog/${draft.blog_slug}
JSON only — no text outside the JSON object.`,
    maxTokens: 2000,
    temperature: 0.3,
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
