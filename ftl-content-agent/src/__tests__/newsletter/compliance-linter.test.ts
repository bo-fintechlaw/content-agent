import { lintNewsletterIssue } from '../../utils/newsletter-compliance-linter.js';
import { BRIEFING_AUTHOR_TITLE, parseIssueJson } from '../../schemas/newsletter.js';

const VALID_ISSUE = {
  title: 'The Briefing — SEC Enforcement',
  segment: 'financial_services',
  issue_date: '2026-06-25',
  slug: 'briefing-sec-enforcement-2026-06',
  author: { name: 'Bo Howell', title: BRIEFING_AUTHOR_TITLE },
  intro:
    'This edition tracks named SEC enforcement patterns and what fund managers should do now.',
  toc: ['SEC enforcement roundup', 'Compliance deadlines'],
  panels: [
    {
      kind: 'feature',
      section_no: 1,
      kicker: 'ANALYSIS · 01 · SEC ENFORCEMENT',
      headline: 'SEC targets disclosure gaps in private funds',
      dek: 'Recent orders show a pattern in marketing and performance claims.',
      stats: [{ value: '12', label: 'actions in Q2' }],
      pull_quote: 'The pattern is disclosure-first, not product-first.',
      action_list: ['Audit marketing decks against filed disclosures'],
      blog_url: 'https://fintechlaw.ai/blog/example-post',
    },
    {
      kind: 'action_items',
      section_no: 2,
      kicker: 'ACTION ITEMS',
      headline: 'What to do now',
      dek: 'Concrete steps by firm type.',
      groups: [{ firm_type: 'RIA', items: ['Document AI oversight in compliance manual'] }],
      consultation_url: 'https://fintechlaw.ai/contact',
    },
  ],
  footer: {
    disclaimer:
      'This newsletter is informational only and is not legal advice. No attorney-client relationship is formed.',
    subscribe_url: 'https://fintechlaw.ai/subscribe',
    physical_address: 'FinTech Law LLC, Washington, DC',
  },
};

describe('IssueJsonSchema', () => {
  it('parses a valid Briefing issue', () => {
    const issue = parseIssueJson(VALID_ISSUE);
    expect(issue.slug).toBe('briefing-sec-enforcement-2026-06');
  });

  it('rejects legacy author title', () => {
    expect(() =>
      parseIssueJson({
        ...VALID_ISSUE,
        author: { name: 'Bo Howell', title: 'Founder & Managing Attorney' },
      })
    ).toThrow();
  });

  it('rejects legacy series title', () => {
    expect(() =>
      parseIssueJson({
        ...VALID_ISSUE,
        title: 'The Financial Edge',
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
      intro: 'We are the best law firm for fintech founders.',
    });
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes('superlative'))).toBe(true);
  });

  it('blocks schema-invalid author title', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      author: { name: 'Bo Howell', title: 'Founder & Managing Attorney' },
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
          section_no: 3,
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

  it('blocks contractions in Briefing voice', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      intro: "This edition tracks what fund managers shouldn't ignore.",
    });
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes('contractions'))).toBe(true);
  });

  it('blocks out-of-order panels', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      panels: [
        VALID_ISSUE.panels[1],
        VALID_ISSUE.panels[0],
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes('panel order'))).toBe(true);
  });

  it('blocks missing footer disclaimer language', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      footer: {
        ...VALID_ISSUE.footer,
        disclaimer: 'Subscribe for updates from our team.',
      },
    });
    expect(result.pass).toBe(false);
  });
});
