import { jest } from '@jest/globals';
import {
  NEWSLETTER_FOOTER_DISCLAIMER,
  NEWSLETTER_PHYSICAL_ADDRESS,
  NEWSLETTER_SUBSCRIBE_URL,
} from '../../constants/newsletter-brand.js';
import { NEWSLETTER_AUTHOR_TITLE, parseIssueJson } from '../../schemas/newsletter.js';

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
  title: 'The Financial Edge — SEC Enforcement',
  segment: 'financial_services',
  issue_date: '2026-06-25',
  slug: 'financial-edge-sec-enforcement-2026-06',
  author: { name: 'Bo Howell', title: NEWSLETTER_AUTHOR_TITLE },
  intro:
    'Named SEC enforcement patterns and concrete action items for fund managers reviewing marketing substantiation files, AI governance controls, and examination readiness workflows across advisory operations.',
  toc: ['SEC roundup', 'Marketing rule'],
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
      kind: 'feature',
      section_no: 2,
      kicker: 'ANALYSIS · 02',
      headline: 'Second story',
      dek: 'Another dek.',
      stats: [{ value: '3', label: 'cases' }],
      pull_quote: 'Quote two.',
      action_list: ['Review filings'],
      blog_url: 'https://fintechlaw.ai/blog/post-b',
    },
    {
      kind: 'action_items',
      section_no: 3,
      kicker: 'ACTION ITEMS',
      headline: 'What to do now',
      dek: 'Steps by firm type.',
      groups: [{ firm_type: 'RIA', items: ['Document AI oversight'] }],
      consultation_url: 'https://fintechlaw.ai/contact',
    },
  ],
  footer: {
    disclaimer: NEWSLETTER_FOOTER_DISCLAIMER,
    subscribe_url: NEWSLETTER_SUBSCRIBE_URL,
    physical_address: NEWSLETTER_PHYSICAL_ADDRESS,
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
    expect(mockHead).toHaveBeenCalledTimes(2);
  });

  it('falls back to GET when HEAD fails', async () => {
    mockHead.mockRejectedValue(new Error('Method Not Allowed'));
    mockGet.mockResolvedValue({ status: 200 });

    const result = await verifyNewsletterBlogLinks(ISSUE_WITH_LINKS);
    expect(result.pass).toBe(true);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('reports failures for broken URLs', async () => {
    mockHead.mockRejectedValue(new Error('ENOTFOUND'));
    mockGet.mockRejectedValue(new Error('ENOTFOUND'));

    const result = await verifyNewsletterBlogLinks(ISSUE_WITH_LINKS);
    expect(result.pass).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
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
