import {
  renderNewsletterDocument,
  buildNewsletterPlainText,
} from '../../emails/newsletter-render-panels.js';
import {
  NEWSLETTER_CONTACT_CTA,
  NEWSLETTER_CONTACT_URL,
  NEWSLETTER_FOOTER_DISCLAIMER,
  NEWSLETTER_PHYSICAL_ADDRESS,
  NEWSLETTER_SHARE_CTA,
  NEWSLETTER_SHARE_URL,
  NEWSLETTER_SUBSCRIBE_URL,
  NEWSLETTER_UNSUBSCRIBE_URL,
} from '../../constants/newsletter-brand.js';
import { NEWSLETTER_AUTHOR_TITLE } from '../../schemas/newsletter.js';

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

describe('newsletter footer rendering', () => {
  it('web archive omits physical address and includes share/contact/unsubscribe CTAs', () => {
    const html = renderNewsletterDocument(VALID_ISSUE, {
      mode: 'web',
      urls: { unsubscribeUrl: NEWSLETTER_UNSUBSCRIBE_URL },
    });

    expect(html).not.toContain(NEWSLETTER_PHYSICAL_ADDRESS);
    expect(html).toContain(NEWSLETTER_SHARE_CTA);
    expect(html).toContain(NEWSLETTER_SHARE_URL);
    expect(html).toContain(NEWSLETTER_CONTACT_CTA);
    expect(html).toContain(NEWSLETTER_CONTACT_URL);
    expect(html).toContain('Unsubscribe');
    expect(html).toContain(NEWSLETTER_UNSUBSCRIBE_URL);
  });

  it('email includes physical address for CAN-SPAM plus footer CTAs', () => {
    const html = renderNewsletterDocument(VALID_ISSUE, {
      mode: 'email',
      urls: {
        archiveUrl: 'https://fintechlaw.ai/newsletters/financial-edge-sec-enforcement-2026-06',
        unsubscribeUrl: NEWSLETTER_UNSUBSCRIBE_URL,
      },
    });

    expect(html).toContain(NEWSLETTER_PHYSICAL_ADDRESS);
    expect(html).toContain(NEWSLETTER_SHARE_CTA);
    expect(html).toContain(NEWSLETTER_CONTACT_CTA);
    expect(html).toContain('Unsubscribe');
  });

  it('plain text includes share and contact lines', () => {
    const text = buildNewsletterPlainText(VALID_ISSUE, {
      archiveUrl: 'https://fintechlaw.ai/newsletters/financial-edge-sec-enforcement-2026-06',
      unsubscribeUrl: NEWSLETTER_UNSUBSCRIBE_URL,
    });

    expect(text).toContain(`Share: ${NEWSLETTER_SHARE_CTA}`);
    expect(text).toContain(`Contact: ${NEWSLETTER_CONTACT_CTA}`);
    expect(text).toContain(NEWSLETTER_UNSUBSCRIBE_URL);
  });
});

describe('pruneNewsletterArchivePages', () => {
  it('deletes issues beyond retention count per segment', async () => {
    const { pruneNewsletterArchivePages } = await import('../../utils/newsletter-archive-retention.js');
    const deletedIds = [];

    const client = {
      fetch: async () => [
        { _id: 'newsletter-newest', slug: 'issue-4', issueDate: '2026-06-25' },
        { _id: 'newsletter-2', slug: 'issue-3', issueDate: '2026-06-11' },
        { _id: 'newsletter-3', slug: 'issue-2', issueDate: '2026-05-28' },
        { _id: 'newsletter-4', slug: 'issue-1', issueDate: '2026-05-14' },
        { _id: 'newsletter-old', slug: 'issue-0', issueDate: '2026-05-01' },
      ],
      delete: async (id) => {
        deletedIds.push(id);
      },
    };

    const result = await pruneNewsletterArchivePages(client, VALID_ISSUE, { keepCount: 4 });

    expect(result.kept).toEqual(['issue-4', 'issue-3', 'issue-2', 'issue-1']);
    expect(result.deleted).toEqual(['issue-0']);
    expect(deletedIds).toEqual(['newsletter-old']);
  });
});
