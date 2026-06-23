import { parseIssueJson } from '../schemas/newsletter.js';
import { renderNewsletterDocument } from '../emails/newsletter-render-panels.js';
import { NEWSLETTER_UNSUBSCRIBE_URL } from '../constants/newsletter-brand.js';

/**
 * Temporary HTML preview for newsletter issues in review (not on fintechlaw.ai).
 * @param {unknown} issueJson
 * @param {{ issueId: string, status?: string }} meta
 */
export function buildNewsletterPreviewHtml(issueJson, meta) {
  const issue = parseIssueJson(issueJson);
  return renderNewsletterDocument(issue, {
    mode: 'web',
    urls: { unsubscribeUrl: NEWSLETTER_UNSUBSCRIBE_URL },
    meta: { ...meta, draft: true },
  });
}
