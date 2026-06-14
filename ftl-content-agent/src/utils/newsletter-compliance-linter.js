import { IssueJsonSchema } from '../schemas/newsletter.js';

const SUPERLATIVE_RE =
  /\b(best|#1|number one|top[- ]rated|leading|premier|guarantee(?:d)?|we will win|assured results?)\b/i;
const OUTCOME_GUARANTEE_RE =
  /\b(guarantee(?:d)?|promise(?:d)? results?|certain outcome|will definitely)\b/i;
const ENZIO_LEGAL_ADVICE_RE =
  /\b(we provide legal advice|our law firm|attorney-client relationship)\b/i;
const DISALLOWED_JURISDICTION_RE =
  /\b(practicing law in|licensed in|admitted in)\s+(?!dc|district of columbia|nevada|ohio)\w+/i;

/**
 * Deterministic compliance linter — blocks before Slack card (v2 §13).
 * @param {unknown} issueJson
 * @returns {{ pass: boolean, violations: string[] }}
 */
export function lintNewsletterIssue(issueJson) {
  const violations = [];

  let issue;
  try {
    issue = IssueJsonSchema.parse(issueJson);
  } catch (err) {
    return {
      pass: false,
      violations: [`schema: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (issue.author.title !== 'Founder & Managing Attorney') {
    violations.push('author.title must be "Founder & Managing Attorney"');
  }

  const textBlob = collectSearchableText(issue);

  if (SUPERLATIVE_RE.test(textBlob)) {
    violations.push('ABA 7.1: superlative or "#1/best" language detected');
  }
  if (OUTCOME_GUARANTEE_RE.test(textBlob)) {
    violations.push('ABA 7.1: outcome guarantee language detected');
  }
  if (DISALLOWED_JURISDICTION_RE.test(textBlob)) {
    violations.push('jurisdiction: practice limited to DC / NV / OH');
  }

  if (!issue.footer.disclaimer.toLowerCase().includes('not legal advice')) {
    violations.push('footer: attorney-advertising disclaimer must state informational / not legal advice');
  }
  if (!issue.footer.physical_address?.trim()) {
    violations.push('CAN-SPAM: physical mailing address required in footer');
  }
  if (!issue.footer.subscribe_url?.trim()) {
    violations.push('footer: subscribe_url required');
  }

  const features = issue.panels.filter((p) => p.kind === 'feature');
  if (!features.length) {
    violations.push('content: at least one feature panel required');
  }
  for (const panel of features) {
    if (!panel.blog_url) {
      violations.push(`feature ${panel.section_no}: blog_url required`);
    }
  }

  for (const panel of issue.panels) {
    if (panel.kind === 'spotlight') {
      if (!panel.enzio_supplied) {
        violations.push(`spotlight ${panel.section_no}: must be flagged enzio_supplied`);
      }
      if (ENZIO_LEGAL_ADVICE_RE.test(panel.body)) {
        violations.push(`spotlight ${panel.section_no}: Enzio must not be framed as a law firm`);
      }
    }
  }

  return { pass: violations.length === 0, violations };
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue */
function collectSearchableText(issue) {
  const parts = [
    issue.intro,
    issue.footer.disclaimer,
    ...issue.toc,
    ...issue.panels.flatMap((p) => {
      const base = [p.kicker, p.headline, p.dek];
      if (p.kind === 'feature') {
        return [...base, p.pull_quote, ...p.action_list];
      }
      if (p.kind === 'compliance_corner') {
        return [...base, ...p.litigation_watch];
      }
      if (p.kind === 'action_items') {
        return [...base, ...p.groups.flatMap((g) => g.items)];
      }
      if (p.kind === 'spotlight') {
        return [...base, p.body];
      }
      return base;
    }),
  ];
  return parts.join('\n');
}
