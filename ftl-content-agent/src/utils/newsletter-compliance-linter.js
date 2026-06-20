import {
  BRIEFING_AUTHOR_TITLE,
  BRIEFING_TITLE_RE,
  IssueJsonSchema,
} from '../schemas/newsletter.js';

const SUPERLATIVE_RE =
  /\b(best|#1|number one|top[- ]rated|leading|premier|guarantee(?:d)?|we will win|assured results?)\b/i;
const OUTCOME_GUARANTEE_RE =
  /\b(guarantee(?:d)?|promise(?:d)? results?|certain outcome|will definitely)\b/i;
const ENZIO_LEGAL_ADVICE_RE =
  /\b(we provide legal advice|our law firm|attorney-client relationship)\b/i;
const DISALLOWED_JURISDICTION_RE =
  /\b(practicing law in|licensed in|admitted in)\s+(?!dc|district of columbia|nevada|ohio)\w+/i;
const CONTRACTION_RE =
  /\b(isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|wouldn't|couldn't|shouldn't|can't|it's|that's|there's|here's|what's|who's|we're|they're|you're|i'm|i've|we've|they've|you've|i'll|we'll|they'll|you'll)\b/i;

/** Canonical panel order for The Briefing (feature required; spotlight optional last). */
const PANEL_KIND_ORDER = ['feature', 'compliance_corner', 'action_items', 'spotlight'];

/**
 * Deterministic compliance linter — blocks before Slack card (Briefing v1).
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

  if (!BRIEFING_TITLE_RE.test(issue.title)) {
    violations.push('title must match "The Briefing — {theme}"');
  }

  if (issue.author.title !== BRIEFING_AUTHOR_TITLE) {
    violations.push(`author.title must be "${BRIEFING_AUTHOR_TITLE}"`);
  }

  const textBlob = collectSearchableText(issue);

  if (SUPERLATIVE_RE.test(textBlob)) {
    violations.push('ABA 7.1: superlative or "#1/best" language detected');
  }
  if (OUTCOME_GUARANTEE_RE.test(textBlob)) {
    violations.push('ABA 7.1: outcome guarantee language detected');
  }
  if (CONTRACTION_RE.test(textBlob)) {
    violations.push('voice: contractions are not permitted in Briefing copy');
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
  if (features.length !== 1) {
    violations.push('content: exactly one feature panel required');
  }
  for (const panel of features) {
    if (!panel.blog_url) {
      violations.push(`feature ${panel.section_no}: blog_url required`);
    }
  }

  const spotlights = issue.panels.filter((p) => p.kind === 'spotlight');
  if (spotlights.length > 1) {
    violations.push('content: at most one spotlight panel allowed');
  }

  const orderViolation = validatePanelOrder(issue.panels);
  if (orderViolation) {
    violations.push(orderViolation);
  }

  for (const panel of spotlights) {
    if (ENZIO_LEGAL_ADVICE_RE.test(panel.body)) {
      violations.push(`spotlight ${panel.section_no}: partner copy must not be framed as a law firm`);
    }
  }

  return { pass: violations.length === 0, violations };
}

/**
 * Panels must follow feature → compliance_corner → action_items → spotlight.
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels']} panels
 */
function validatePanelOrder(panels) {
  let lastIdx = -1;
  for (const panel of panels) {
    const idx = PANEL_KIND_ORDER.indexOf(panel.kind);
    if (idx < lastIdx) {
      return `panel order: ${panel.kind} must not appear before earlier sections (expected ${PANEL_KIND_ORDER.join(' → ')})`;
    }
    lastIdx = idx;
  }
  if (panels.length && panels[0].kind !== 'feature') {
    return 'panel order: first panel must be feature';
  }
  return null;
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
