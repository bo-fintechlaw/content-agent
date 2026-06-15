import { extractHttpUrlsFromDraft } from './citation-harvest.js';

const SELF_CITATION_DOMAINS = ['fintechlaw.ai'];

function isSelfCitation(url) {
  if (!url) return false;
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return SELF_CITATION_DOMAINS.some(
      (d) => host === d || host.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

/**
 * Free-text /suggest topics often have no source_url. When the drafter cites
 * a press release or article inline, use the first independent URL as primary.
 * @param {Record<string, any>} draft
 * @returns {string}
 */
export function inferPrimarySourceUrlFromDraft(draft) {
  const urls = extractHttpUrlsFromDraft(draft);
  const independent = urls.filter((u) => !isSelfCitation(u));
  return independent[0] ?? '';
}

/**
 * Draft blocked by prejudge with judge_pass=false but never reached the judge.
 * Recoverable when the only hard block was a missing topic source_url.
 * @param {{ judge_pass?: boolean | null, judge_scores?: unknown, judge_flags?: unknown }} draft
 */
export function isRecoverablePrejudgeBlockedDraft(draft) {
  if (draft.judge_pass !== false) return false;
  if (draft.judge_scores != null) return false;
  const flags = Array.isArray(draft.judge_flags) ? draft.judge_flags : [];
  const prejudge = flags.filter(
    (f) => typeof f === 'string' && f.startsWith('prejudge:')
  );
  if (!prejudge.length) return false;
  const hardFlags = prejudge.map((f) => f.slice('prejudge:'.length));
  return hardFlags.every((f) => f === 'missing_primary_source_url');
}
