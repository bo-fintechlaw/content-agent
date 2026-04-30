export const CITATION_SUBAGENT_SYSTEM = `You are a citation and source-verification subagent. You do not re-score the whole post. Your job is to assess whether cited URLs in a legal or fintech blog draft are **reachable** and **reasonably support** how the author uses them in context.

You receive, per URL: HTTP status, page title, and a plain-text preview of page content. You do not have browsing beyond that preview. If a server returns 403, a paywall, or a very small preview, use alignment "unclear" and do not assert bad faith.

For each URL, return alignment_with_draft: "aligned" (plausibly supports the surrounding claim) | "unclear" (cannot verify from preview) | "misaligned" (link broken, 404, wrong page, or clearly contradicts the use in the draft).

List subagent_flags as needed from: broken_or_unreachable, likely_wrong_target, paywall_or_blocked, misrepresents_source.

Return strict JSON only, no markdown fences.`;

const SUBAGENT_JSON_EXAMPLE = `
{
  "assessments": [
    {
      "url": "https://example.com/doc",
      "alignment_with_draft": "aligned",
      "notes": "Short rationale referencing fetch status and preview"
    }
  ],
  "subagent_flags": [],
  "subagent_summary": "One or two sentences for the main judge"
}`.trim();

/**
 * @param {object} params
 * @param {object} params.draft
 * @param {Array} params.fetches
 */
export function buildCitationSubagentUserPrompt({ draft, fetches }) {
  const fetchBlock = JSON.stringify(
    fetches.map((f) => ({
      url: f.url,
      finalUrl: f.finalUrl,
      ok: f.ok,
      status: f.status,
      error: f.error,
      title: f.title,
      textPreview: f.textPreview ? f.textPreview.slice(0, 2_000) : '',
    })),
    null,
    2
  );

  return `Draft to verify citations against.

Blog title: ${draft?.blog_title ?? ''}

Relevant body (stringified; links may appear as Markdown in the body text):
${JSON.stringify(draft?.blog_body ?? [], null, 2)}

HTTP fetch result per unique cited URL (title and text preview may be truncated; status 0 = client error or timeout):
${fetchBlock}

Return JSON with this exact structure and keys:
${SUBAGENT_JSON_EXAMPLE}

- alignment_with_draft must be one of: aligned, unclear, misaligned
- subagent_flags: use only the flag names from the subagent spec above; can be an empty array
- Include one entry in assessments for each URL in the fetch list, in the same order when possible`;
}
