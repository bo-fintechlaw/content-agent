import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { fail, start, success } from '../utils/logger.js';

const BLOG_REVISER_SYSTEM_PROMPT = `You are Bo Howell, Managing Director of FinTech Law (fintechlaw.ai). You are revising an existing blog draft based on a single piece of human reviewer feedback.

CRITICAL RULES — these override everything else:
- Make ONLY the change(s) the feedback requests. Do not rewrite, polish, tighten, or restructure sections that the feedback does not address.
- Sections unaffected by the feedback MUST be returned verbatim — byte-for-byte identical to the input, including punctuation, spacing, blank lines, and Markdown formatting.
- Do not "improve" wording, swap synonyms, or restructure paragraphs that the feedback does not call out.
- Do not add new sections unless the feedback explicitly asks for one. Do not delete sections unless the feedback asks for that.
- Preserve all existing inline citations and links exactly as written in any unchanged section.

Voice rules to maintain in any sentences you do change:
- No contractions ("is not", "does not", "cannot", "will not").
- Never fabricate personal experiences ("a client asked me", "in my conversations with"). Cite published data and public sources only.
- Match Bo's declarative, periodic voice. No hedging qualifiers, no "navigate the landscape" filler.

Return strict JSON only — no markdown fences, no commentary outside the JSON object.`;

function buildBlogReviserUserPrompt({ draft, feedback }) {
  return `Revise this blog draft based on the reviewer feedback below. Change ONLY what the feedback addresses; leave every other section verbatim.

CURRENT DRAFT
=============
Title: ${String(draft.blog_title ?? '')}
SEO title: ${String(draft.blog_seo_title ?? '')}
SEO description: ${String(draft.blog_seo_description ?? '')}

Body sections (JSON array — preserve order and shape):
${JSON.stringify(draft.blog_body ?? [], null, 2)}

REVIEWER FEEDBACK
=================
${feedback}

Return JSON with this exact structure:
{
  "blog_title": "the title — return unchanged unless the feedback asks for a title change",
  "blog_seo_title": "SEO title — return unchanged unless the feedback addresses it",
  "blog_seo_description": "SEO description — return unchanged unless the feedback addresses it",
  "blog_body": [
    { "title": "section title", "body": "section body markdown", "has_background": false }
  ],
  "change_summary": "One sentence describing exactly what you changed and why. If you changed nothing because the feedback was unactionable, say so.",
  "changed_section_indices": [0, 2]
}

Requirements:
- blog_body must be an array. Preserve the same number of sections unless the feedback explicitly asks to add or remove one.
- For every section index NOT listed in changed_section_indices, the section's title and body must be byte-for-byte identical to the input.
- changed_section_indices must accurately list every section index whose body or title differs from the input.
- JSON only — no text outside the JSON object.`;
}

/**
 * Targeted revision of an existing blog draft using human reviewer feedback.
 * Edits the same draft row in place: only the sections the feedback addresses
 * change; the rest of the draft (including unchanged citations and image asset)
 * is preserved. Resets judge_pass / judge_scores so the caller can re-judge
 * and re-send the Slack review with fresh scores.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 * @param {string} draftId
 * @param {string} feedback
 * @returns {Promise<{
 *   draftId: string,
 *   blogTitle: string,
 *   changeSummary: string,
 *   changedSectionIndices: number[],
 * }>}
 */
export async function reviseBlogContent(supabase, config, draftId, feedback) {
  start('reviseBlogContent', { draftId });

  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select(
      'id, topic_id, blog_title, blog_body, blog_seo_title, blog_seo_description, judge_flags, revision_count'
    )
    .eq('id', draftId)
    .single();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error(`Draft ${draftId} not found`);

  const client = createAnthropicClient(config.ANTHROPIC_API_KEY);

  const result = await promptJson(client, {
    model: config.ANTHROPIC_MODEL,
    system: BLOG_REVISER_SYSTEM_PROMPT,
    user: buildBlogReviserUserPrompt({ draft, feedback }),
    maxTokens: 8000,
    temperature: 0.1,
  });

  const revisedBody = Array.isArray(result.blog_body) ? result.blog_body : draft.blog_body;
  const changedIndices = Array.isArray(result.changed_section_indices)
    ? result.changed_section_indices.filter((n) => Number.isInteger(n) && n >= 0)
    : [];

  // Defensive verbatim guard: for any section the model said it didn't change,
  // restore the original. The system prompt already asks for byte-identical
  // preservation, but the model occasionally rewrites whitespace or swaps a
  // synonym. The reviewer wants targeted edits, so we enforce that here rather
  // than trusting the model alone.
  const originalSections = Array.isArray(draft.blog_body) ? draft.blog_body : [];
  const guardedBody = revisedBody.map((section, i) => {
    if (changedIndices.includes(i)) return section;
    if (i < originalSections.length) return originalSections[i];
    return section;
  });

  const updates = {
    blog_title: result.blog_title ?? draft.blog_title,
    blog_seo_title: result.blog_seo_title ?? draft.blog_seo_title,
    blog_seo_description: result.blog_seo_description ?? draft.blog_seo_description,
    blog_body: guardedBody,
    revision_count: (draft.revision_count ?? 0) + 1,
    judge_pass: null,
    judge_scores: null,
  };

  const { error: upErr } = await supabase
    .from('content_drafts')
    .update(updates)
    .eq('id', draftId);
  if (upErr) throw new Error(upErr.message);

  success('reviseBlogContent', {
    draftId,
    changeSummary: String(result.change_summary ?? '').slice(0, 200),
    changedSectionIndices: changedIndices,
  });

  return {
    draftId,
    blogTitle: updates.blog_title,
    changeSummary: String(result.change_summary ?? ''),
    changedSectionIndices: changedIndices,
  };
}
