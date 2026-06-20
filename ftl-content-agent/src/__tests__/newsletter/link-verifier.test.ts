import { jest } from '@jest/globals';
import { BRIEFING_AUTHOR_TITLE, parseIssueJson } from '../../schemas/newsletter.js';

const mockHead = jest.fn();
const mockGet = jest.fn();

await jest.unstable_mockModule('axios', () => ({
  default: {
    head: mockHead,
    get: mockGet,
  },
}));

const { verifyNewsletterBlogLinks } = await import('../../utils/newsletter-link-verifier.js');

const ISSUE_WITH_LINKS = parseIssueJson({
  title: 'The Briefing — SEC Enforcement',
  segment: 'financial_services',
  issue_date: '2026-06-25',
  slug: 'briefing-sec-enforcement-2026-06',
  author: { name: 'Bo Howell', title: BRIEFING_AUTHOR_TITLE },
  intro: 'Named SEC enforcement patterns and concrete action items.',
  toc: ['SEC roundup'],
  panels: [
    {
      kind: 'feature',
      section_no: 1,
      kicker: 'ANALYSIS · 01',
      headline: 'SEC targets disclosure gaps',
      dek: 'Recent orders show a pattern.',
      stats: [{ value: '12', label: 'actions' }],
      pull_quote: 'Disclosure-first enforcement.',
      action_list: ['Audit marketing decks'],
      blog_url: 'https://fintechlaw.ai/blog/post-a',
    },
    {
      kind: 'action_items',
      section_no: 2,
      kicker: 'ACTION ITEMS',
      headline: 'What to do now',
      dek: 'Steps by firm type.',
      groups: [{ firm_type: 'RIA', items: ['Document AI oversight'] }],
      consultation_url: 'https://fintechlaw.ai/contact',
    },
  ],
  footer: {
    disclaimer:
      'This newsletter is informational only and is not legal advice. No attorney-client relationship is formed.',
    subscribe_url: 'https://fintechlaw.ai/subscribe',
    physical_address: 'FinTech Law LLC, Washington, DC',
  },
});

describe('verifyNewsletterBlogLinks', () => {
  beforeEach(() => {
    mockHead.mockReset();
    mockGet.mockReset();
  });

  it('passes when all feature blog_url HEAD requests succeed', async () => {
    mockHead.mockResolvedValue({ status: 200 });

    const result = await verifyNewsletterBlogLinks(ISSUE_WITH_LINKS);
    expect(result.pass).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(mockHead).toHaveBeenCalledTimes(1);
  });

  it('falls back to GET when HEAD fails', async () => {
    mockHead.mockRejectedValue(new Error('Method Not Allowed'));
    mockGet.mockResolvedValue({ status: 200 });

    const result = await verifyNewsletterBlogLinks(ISSUE_WITH_LINKS);
    expect(result.pass).toBe(true);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('reports failures for broken URLs', async () => {
    mockHead.mockRejectedValue(new Error('ENOTFOUND'));
    mockGet.mockRejectedValue(new Error('ENOTFOUND'));

    const result = await verifyNewsletterBlogLinks(ISSUE_WITH_LINKS);
    expect(result.pass).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].url).toBe('https://fintechlaw.ai/blog/post-a');
  });

  it('ignores non-feature panels', async () => {
    mockHead.mockResolvedValue({ status: 200 });

    const result = await verifyNewsletterBlogLinks(ISSUE_WITH_LINKS);
    expect(result.pass).toBe(true);
    const calledUrls = mockHead.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://fintechlaw.ai/contact');
  });
});
