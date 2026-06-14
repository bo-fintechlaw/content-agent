import { lintNewsletterIssue } from '../../utils/newsletter-compliance-linter.js';
import { parseIssueJson } from '../../schemas/newsletter.js';

const VALID_ISSUE = {
  title: 'The Financial Edge',
  segment: 'financial_services',
  issue_date: '2026-06-25',
  slug: 'financial-edge-2026-06',
  author: { name: 'Bo Howell', title: 'Founder & Managing Attorney' },
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
  it('parses a valid issue', () => {
    const issue = parseIssueJson(VALID_ISSUE);
    expect(issue.slug).toBe('financial-edge-2026-06');
  });

  it('rejects wrong author title (masthead bug)', () => {
    expect(() =>
      parseIssueJson({
        ...VALID_ISSUE,
        author: { name: 'Bo Howell', title: 'Managing Director' },
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
      author: { name: 'Bo Howell', title: 'Managing Director' },
    });
    expect(result.pass).toBe(false);
    expect(result.violations[0]).toMatch(/schema/i);
  });

  it('requires enzio_supplied on spotlight panels', () => {
    const result = lintNewsletterIssue({
      ...VALID_ISSUE,
      panels: [
        ...VALID_ISSUE.panels,
        {
          kind: 'spotlight',
          section_no: 3,
          kicker: 'SPOTLIGHT',
          headline: 'Partner spotlight',
          dek: 'Enzio update',
          body: 'Enzio platform update supplied by partner.',
          enzio_supplied: false,
        },
      ],
    });
    expect(result.pass).toBe(false);
  });
});
