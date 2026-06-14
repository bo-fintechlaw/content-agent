#!/usr/bin/env node
/**
 * E2E shadow-path smoke test (no live APIs required for lint/schema).
 * Usage: node scripts/e2e-newsletter-shadow.mjs
 */
import { lintNewsletterIssue } from '../src/utils/newsletter-compliance-linter.js';
import { parseIssueJson } from '../src/schemas/newsletter.js';

const FIXTURE = {
  title: 'The Financial Edge',
  segment: 'financial_services',
  issue_date: '2026-06-25',
  slug: 'financial-edge-2026-06',
  author: { name: 'Bo Howell', title: 'Founder & Managing Attorney' },
  intro: 'Named SEC enforcement patterns and concrete action items for fund managers.',
  toc: ['SEC enforcement roundup', 'Compliance deadlines', 'Action items'],
  panels: [
    {
      kind: 'feature',
      section_no: 1,
      kicker: 'ANALYSIS · 01',
      headline: 'SEC targets disclosure gaps',
      dek: 'Recent orders show a pattern in marketing claims.',
      stats: [{ value: '12', label: 'actions in Q2' }],
      pull_quote: 'Disclosure-first enforcement is the throughline.',
      action_list: ['Audit marketing decks against filed disclosures'],
      blog_url: 'https://fintechlaw.ai/blog/example-post',
    },
    {
      kind: 'compliance_corner',
      section_no: 2,
      kicker: 'COMPLIANCE CORNER',
      headline: 'Deadlines to watch',
      dek: 'Critical dates for RIAs and fund managers.',
      deadlines: [{ date: '2026-07-01', requirement: 'Form ADV annual amendment' }],
      litigation_watch: ['Private fund marketing rule challenges'],
    },
    {
      kind: 'action_items',
      section_no: 3,
      kicker: 'ACTION ITEMS',
      headline: 'What to do now',
      dek: 'Steps by firm type.',
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

function main() {
  const issue = parseIssueJson(FIXTURE);
  const lint = lintNewsletterIssue(issue);
  if (!lint.pass) {
    console.error('Linter failed:', lint.violations);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        flow: 'CMO assemble → lint → render_newsletter_issue → newsletter_issue_draft (#cmo-bo)',
        issue_slug: issue.slug,
        slack_channel: 'C0BB9U7AN0Y',
        autonomy: 'shadow',
        ceiling: 'approve',
      },
      null,
      2
    )
  );
}

main();
