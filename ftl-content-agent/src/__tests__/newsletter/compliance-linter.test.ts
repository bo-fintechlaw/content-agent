import { lintNewsletterIssue } from '../../utils/newsletter-compliance-linter.js';
import {
  NEWSLETTER_FOOTER_DISCLAIMER,
  NEWSLETTER_PHYSICAL_ADDRESS,
  NEWSLETTER_SUBSCRIBE_URL,
} from '../../constants/newsletter-brand.js';
import { NEWSLETTER_AUTHOR_TITLE, parseIssueJson } from '../../schemas/newsletter.js';

const LONG_COPY = Array.from({ length: 8 }, () =>
  'This edition tracks named SEC enforcement patterns, private fund disclosure expectations, and operational controls fund managers should implement before the next examination cycle. ' +
    'We focus on concrete steps rather than abstract commentary because regulatory risk compounds when teams defer documentation updates. ' +
    'The SEC continues to prioritize marketing rule compliance, AI governance in advisory workflows, and custody-adjacent arrangements that blur traditional service boundaries.'
).join(' ');

const VALID_ISSUE = {
  title: 'The Financial Edge — SEC Enforcement',
  segment: 'financial_services',
  issue_date: '2026-06-25',
  slug: 'financial-edge-sec-enforcement-2026-06',
  author: { name: 'Bo Howell', title: NEWSLETTER_AUTHOR_TITLE },
  intro: LONG_COPY,
  toc: ['SEC enforcement roundup', 'Compliance deadlines', 'Action items'],
  panels: [
    {
      kind: 'feature',
      section_no: 1,
      kicker: 'ANALYSIS · 01 · SEC ENFORCEMENT',
      headline: 'SEC targets disclosure gaps in private funds',
      dek: 'Recent orders show a pattern in marketing and performance claims.',
      stats: [{ value: '12', label: 'actions in Q2' }],
      pull_quote: 'The pattern is disclosure-first, not product-first.',
      action_list: ['Audit marketing decks against filed disclosures', 'Document AI oversight controls'],
      blog_url: 'https://fintechlaw.ai/blog/example-post-a',
    },
    {
      kind: 'feature',
      section_no: 2,
      kicker: 'ANALYSIS · 02 · MARKETING RULE',
      headline: 'Marketing rule exams focus on substantiation',
      dek: 'Examiners are asking for backup files tied to performance advertising.',
      stats: [{ value: '8', label: 'recent letters' }],
      pull_quote: 'Substantiation files must match what clients actually saw.',
      action_list: ['Reconcile social posts with archived substantiation packets'],
      blog_url: 'https://fintechlaw.ai/blog/example-post-b',
    },
    {
      kind: 'compliance_corner',
      section_no: 3,
      kicker: 'COMPLIANCE CORNER',
      headline: 'Deadlines on the horizon',
      dek: 'Key dates for registered advisers and private fund advisers.',
      deadlines: [{ date: 'Jul 15', requirement: 'Form ADV annual amendment window closes' }],
      litigation_watch: ['Circuit split on digital asset custody continues to develop'],
    },
    {
      kind: 'action_items',
      section_no: 4,
      kicker: 'ACTION ITEMS',
      headline: 'What to do now',
      dek: 'Concrete steps by firm type.',
      groups: [{ firm_type: 'RIA', items: ['Document AI oversight in compliance manual'] }],
      consultation_url: 'https://fintechlaw.ai/contact',
    },
  ],
  footer: {
    disclaimer: NEWSLETTER_FOOTER_DISCLAIMER,
    subscribe_url: NEWSLETTER_SUBSCRIBE_URL,
    physical_address: NEWSLETTER_PHYSICAL_ADDRESS,
  },
};

describe('IssueJsonSchema', () => {
  it('parses a valid Financial Edge issue', () => {
    const issue = parseIssueJson(VALID_ISSUE);
    expect(issue.slug).toBe('financial-edge-sec-enforcement-2026-06');
  });

  it('rejects wrong author title', () => {
    expect(() =>
      parseIssueJson({
        ...VALID_ISSUE,
        author: { name: 'Bo Howell', title: 'Managing Director & CEO' },
      })
    ).toThrow();
  });

  it('rejects legacy Briefing series title', () => {
    expect(() =>
      parseIssueJson({
        ...VALID_ISSUE,
        title: 'The Briefing — SEC Enforcement',
      })
    ).toThrow();
  });

  it('rejects fewer than two feature panels', () => {
    expect(() =>
      parseIssueJson({
        ...VALID_ISSUE,
        panels: VALID_ISSUE.panels.filter((p) => p.kind !== 'feature' || p.section_no === 1),
      })
    ).toThrow();
  });
});

describe('lintNewsletterIssue', () => {
  it('passes a compliant issue', () => {
    const result = lintNewsletterIssue(VALID_ISSUE);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('blocks superlatives (ABA 7.1)', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      intro: `${LONG_COPY} We are the best law firm for fintech founders.`,
    });
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes('superlative'))).toBe(true);
  });

  it('blocks schema-invalid author title', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      author: { name: 'Bo Howell', title: 'Managing Director' },
    });
    expect(result.pass).toBe(false);
    expect(result.violations[0]).toMatch(/schema/i);
  });

  it('blocks spotlight framed as a law firm', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      panels: [
        ...VALID_ISSUE.panels,
        {
          kind: 'spotlight',
          section_no: 5,
          kicker: 'SPOTLIGHT',
          headline: 'Partner update',
          dek: 'Platform partner news',
          body: 'We provide legal advice through our law firm partnership.',
        },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes('spotlight'))).toBe(true);
  });

  it('blocks out-of-order panels', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      panels: [VALID_ISSUE.panels[3], VALID_ISSUE.panels[0], VALID_ISSUE.panels[1], VALID_ISSUE.panels[2]],
    });
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes('panel order'))).toBe(true);
  });

  it('blocks non-verbatim footer disclaimer', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      footer: {
        ...VALID_ISSUE.footer,
        disclaimer: 'Subscribe for updates from our team.',
      },
    });
    expect(result.pass).toBe(false);
  });

  it('blocks word count outside 500–800', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      intro:
        'This intro is intentionally short for testing word count enforcement across the full issue body and panel copy combined in the compliance linter.',
      panels: VALID_ISSUE.panels.slice(0, 2),
    });
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes('word count'))).toBe(true);
  });
});
