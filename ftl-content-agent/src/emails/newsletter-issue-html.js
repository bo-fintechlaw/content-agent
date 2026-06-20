import {
  renderNewsletterDocument,
  buildNewsletterPlainText,
} from './newsletter-render-panels.js';

/**
 * Table-based HTML email for newsletter issues (~600px).
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ archiveUrl: string, unsubscribeUrl: string }} urls
 */
export function buildNewsletterEmailHtml(issue, urls) {
  return renderNewsletterDocument(issue, { mode: 'email', urls });
}

/**
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ archiveUrl: string, unsubscribeUrl: string }} urls
 */
export function buildNewsletterEmailText(issue, urls) {
  return buildNewsletterPlainText(issue, urls);
}
