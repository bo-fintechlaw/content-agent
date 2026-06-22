import {
  NEWSLETTER_AUTHOR_TITLE,
  NEWSLETTER_FOOTER_DISCLAIMER,
  titlePrefixForSegment,
} from '../constants/newsletter-brand.js';
import { IssueJsonSchema, PANEL_KIND_ORDER } from '../schemas/newsletter.js';

const SUPERLATIVE_RE =
  /\b(best|#1|number one|top[- ]rated|leading|premier|guarantee(?:d)?|we will win|assured results?)\b/i;
const OUTCOME_GUARANTEE_RE =
  /\b(guarantee(?:d)?|promise(?:d)? results?|certain outcome|will definitely)\b/i;
const ENZIO_LEGAL_ADVICE_RE =
  /\b(we provide legal advice|our law firm|attorney-client relationship)\b/i;
const DISALLOWED_JURISDICTION_RE =
  /\b(practicing law in|licensed in|admitted in)\s+(?!dc|district of columbia|nevada|ohio)\w+/i;

const WORD_COUNT_MIN = 500;
const WORD_COUNT_MAX = 800;

/**
 * Deterministic compliance linter — blocks before Slack card.
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

  const titleRe = titlePrefixForSegment(issue.segment);
  if (!titleRe.test(issue.title)) {
    violations.push(`title must match segment prefix for ${issue.segment}`);
  }

  if (issue.author.title !== NEWSLETTER_AUTHOR_TITLE) {
    violations.push(`author.title must be "${NEWSLETTER_AUTHOR_TITLE}"`);
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

  if (issue.footer.disclaimer.trim() !== NEWSLETTER_FOOTER_DISCLAIMER) {
    violations.push('footer: disclaimer must match verbatim newsletter-brand constant');
  }
  if (!issue.footer.physical_address?.trim()) {
    violations.push('CAN-SPAM: physical mailing address required in footer');
  }
  if (!issue.footer.subscribe_url?.trim()) {
    violations.push('footer: subscribe_url required');
  }

  const features = issue.panels.filter((p) => p.kind === 'feature');
  if (features.length < 2 || features.length > 3) {
    violations.push('content: 2–3 feature panels required');
  }
  if (issue.panels.length > 6) {
    violations.push('content: at most 6 panels total');
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

  const wordCount = countWords(textBlob);
  if (wordCount < WORD_COUNT_MIN || wordCount > WORD_COUNT_MAX) {
    violations.push(`word count: ${wordCount} words (required ${WORD_COUNT_MIN}–${WORD_COUNT_MAX})`);
  }

  return { pass: violations.length === 0, violations };
}

/**
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels']} panels
 */
function validatePanelOrder(panels) {
  let lastIdx = -1;
  let seenNonFeature = false;

  for (const panel of panels) {
    if (panel.kind !== 'feature' && !seenNonFeature) {
      seenNonFeature = true;
    }
    if (panel.kind === 'feature' && seenNonFeature) {
      return 'panel order: all feature panels must appear before compliance_corner / action_items / spotlight';
    }

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

/** @param {string} text */
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
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
