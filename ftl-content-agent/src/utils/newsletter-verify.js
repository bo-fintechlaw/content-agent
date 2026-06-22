import { extractHttpUrlsFromDraft, fetchAllCitationPreviews } from '../pipeline/citation-harvest.js';
import { runCitationVerificationSubagent } from '../pipeline/citation-subagent.js';
import { runClaimVerificationSubagent } from '../pipeline/claim-verification-subagent.js';
import { parseIssueJson } from '../schemas/newsletter.js';
import { start, success } from '../utils/logger.js';

/**
 * Convert newsletter issue JSON to a draft-shaped object for subagents.
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 */
export function issueToDraftShape(issue) {
  const sections = issue.panels.map((panel) => {
    if (panel.kind === 'feature') {
      return {
        title: panel.headline,
        body: `${panel.dek}\n\n${panel.pull_quote}\n\n${panel.action_list.join('\n')}\n\n${panel.blog_url}`,
      };
    }
    if (panel.kind === 'compliance_corner') {
      return {
        title: panel.headline,
        body: [...(panel.litigation_watch ?? []), ...(panel.deadlines ?? []).map((d) => `${d.date}: ${d.requirement}`)].join('\n'),
      };
    }
    if (panel.kind === 'action_items') {
      return {
        title: panel.headline,
        body: panel.groups.flatMap((g) => g.items).join('\n') + `\n${panel.consultation_url}`,
      };
    }
    if (panel.kind === 'spotlight') {
      return { title: panel.headline, body: panel.body };
    }
    return { title: panel.headline ?? issue.title, body: panel.dek ?? '' };
  });

  return {
    blog_title: issue.title,
    blog_body: [{ title: 'Intro', body: issue.intro }, ...sections],
    linkedin_post: issue.intro,
    x_post: '',
  };
}

/**
 * @param {Record<string, unknown>} config
 * @param {unknown} issueJson
 * @returns {Promise<{ ok: boolean, violations: string[] }>}
 */
export async function verifyNewsletterClaims(config, issueJson) {
  start('verifyNewsletterClaims');
  const issue = parseIssueJson(issueJson);
  const draft = issueToDraftShape(issue);
  const result = await runClaimVerificationSubagent(null, config, { draft });

  const violations = (result.assessments ?? [])
    .filter((a) => a.verdict === 'contradicted')
    .map((a) => `claim contradicted: ${a.claim}${a.rationale ? ` — ${a.rationale}` : ''}`);

  if (result.subagent_flags?.includes('claim_verification_unavailable')) {
    violations.push(`claim verification unavailable: ${result.subagent_summary ?? 'subagent failed'}`);
  }

  success('verifyNewsletterClaims', { violations: violations.length });
  return { ok: violations.length === 0, violations };
}

/**
 * @param {Record<string, unknown>} config
 * @param {unknown} issueJson
 * @returns {Promise<{ ok: boolean, violations: string[] }>}
 */
export async function verifyNewsletterCitations(config, issueJson) {
  start('verifyNewsletterCitations');
  const issue = parseIssueJson(issueJson);
  const draft = issueToDraftShape(issue);
  const urls = extractHttpUrlsFromDraft(draft);
  const fetches = await fetchAllCitationPreviews(urls);
  const result = await runCitationVerificationSubagent(null, config, { draft, fetches });

  const violations = (result.assessments ?? [])
    .filter((a) => a.alignment_with_draft === 'misaligned')
    .map((a) => `citation misaligned: ${a.url}${a.notes ? ` — ${a.notes}` : ''}`);

  if (result.subagent_flags?.includes('citation_subagent_unavailable')) {
    violations.push(`citation verification unavailable: ${result.subagent_summary ?? 'subagent failed'}`);
  }

  success('verifyNewsletterCitations', { violations: violations.length });
  return { ok: violations.length === 0, violations };
}
