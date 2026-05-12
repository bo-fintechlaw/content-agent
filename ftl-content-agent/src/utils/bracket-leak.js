/**
 * Bracket-leak detector. The drafter and reviser sometimes hedge uncertainty by
 * leaving editorial placeholders in square brackets — "[insert docket number]",
 * "[TBD]", "[confirm date]", "[Editor: verify]", etc. These render to readers
 * verbatim and are the most embarrassing class of failure on the site.
 *
 * The drafter system prompt forbids them, but the model still emits them when
 * it cannot find a verified value. This guard catches what survives the prompt
 * and feeds the offending substring back into the revision instructions so the
 * judge or reviser can resolve it precisely (not just "remove all brackets").
 *
 * The detector ignores Markdown link labels of the form `[text](url)` — those
 * are legitimate. It matches only square-bracket spans whose inner text looks
 * like an editorial directive (insert/TBD/confirm/verify/placeholder/Editor:/
 * Note:/draft note/check/cite).
 */

// Editorial keywords that, when found inside [ ], indicate a placeholder leak.
// Conservative on purpose — matching "[the SEC]" or "[2024]" would generate
// false positives. We require an editorial-directive word inside the brackets.
const PLACEHOLDER_TOKENS = [
  'insert',
  'tbd',
  'confirm',
  'verify',
  'placeholder',
  'editor',
  'editorial',
  'draft note',
  'note for editorial',
  'note for review',
  'note to editor',
  'pending',
  'fill in',
  'fill-in',
  'add link',
  'add citation',
  'add cite',
  'cite needed',
  'citation needed',
  'needs citation',
  'check date',
  'check this',
  'tk',
];

// Match a [ ... ] span that does NOT immediately precede a `(` (which would be
// a Markdown link). Limit inner length to 200 chars so we don't grab huge
// stretches across lines.
const BRACKET_SPAN_RE = /\[([^\]]{1,200})\](?!\()/g;

/**
 * @param {string} text - any concatenated draft text (body markdown, title, etc.)
 * @returns {string[]} array of unique offending substrings (including the brackets)
 */
export function findBracketLeaks(text) {
  if (!text || typeof text !== 'string') return [];
  const leaks = new Set();
  for (const match of text.matchAll(BRACKET_SPAN_RE)) {
    const inner = String(match[1] ?? '').trim().toLowerCase();
    if (!inner) continue;
    if (PLACEHOLDER_TOKENS.some((tok) => inner.includes(tok))) {
      leaks.add(match[0]);
    }
  }
  return [...leaks];
}

/**
 * Collect all leak substrings across the typed fields of a drafter/reviser
 * output. Pass any of: blog_title, blog_seo_title, blog_seo_description,
 * blog_body (array of {title, body}), linkedin_post, x_post, x_thread (array).
 *
 * @param {object} draft
 * @returns {string[]} unique leak substrings across all fields
 */
export function findBracketLeaksInDraft(draft) {
  if (!draft || typeof draft !== 'object') return [];
  const parts = [];
  parts.push(String(draft.blog_title ?? ''));
  parts.push(String(draft.blog_seo_title ?? ''));
  parts.push(String(draft.blog_seo_description ?? ''));
  if (Array.isArray(draft.blog_body)) {
    for (const section of draft.blog_body) {
      parts.push(String(section?.title ?? ''));
      parts.push(String(section?.body ?? ''));
    }
  }
  parts.push(String(draft.linkedin_post ?? ''));
  parts.push(String(draft.x_post ?? ''));
  if (Array.isArray(draft.x_thread)) {
    for (const t of draft.x_thread) parts.push(String(t ?? ''));
  }
  const combined = parts.join('\n');
  return findBracketLeaks(combined);
}

/**
 * Build a precise revision instruction the reviser / judge can act on. The
 * instruction names every offending substring verbatim so the reviser doesn't
 * have to guess what was wrong.
 *
 * @param {string[]} leaks
 */
export function buildBracketLeakRevisionInstruction(leaks) {
  if (!leaks?.length) return '';
  const list = leaks.map((s) => `  - ${s}`).join('\n');
  return `Remove or resolve these editorial placeholder strings — they leaked into the draft body and would render to readers verbatim. Either delete the surrounding claim, or replace the placeholder with a verified value from the VERIFIED FACTS block / primary sources. Do NOT leave any of these in the output:\n${list}`;
}
