/**
 * @param {Record<string, unknown>} config
 * @param {string} issueId
 */
export function newsletterIssuePreviewUrl(config, issueId) {
  const base = String(config.APP_BASE_URL ?? '').replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/api/newsletter-issues/${issueId}/preview`;
}
