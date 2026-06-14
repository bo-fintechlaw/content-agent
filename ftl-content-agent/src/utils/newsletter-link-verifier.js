import axios from 'axios';
import { fail, start, success } from './logger.js';

/**
 * Verify every feature panel blog_url resolves (HTTP HEAD/GET).
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ pass: boolean, failures: Array<{ url: string, reason: string }> }>}
 */
export async function verifyNewsletterBlogLinks(issue, options = {}) {
  start('verifyNewsletterBlogLinks', { slug: issue?.slug });
  const timeoutMs = options.timeoutMs ?? 10_000;
  const failures = [];

  const features = (issue.panels ?? []).filter((p) => p.kind === 'feature');
  for (const panel of features) {
    const url = panel.blog_url;
    try {
      const res = await axios.head(url, {
        timeout: timeoutMs,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      if (res.status >= 400) {
        failures.push({ url, reason: `HTTP ${res.status}` });
      }
    } catch (err) {
      try {
        const res = await axios.get(url, {
          timeout: timeoutMs,
          maxRedirects: 5,
          validateStatus: (s) => s >= 200 && s < 400,
        });
        if (res.status >= 400) {
          failures.push({ url, reason: `HTTP ${res.status}` });
        }
      } catch (getErr) {
        const reason =
          getErr instanceof Error ? getErr.message : String(getErr);
        failures.push({ url, reason });
        fail('verifyNewsletterBlogLinks', getErr, { url });
      }
    }
  }

  const result = { pass: failures.length === 0, failures };
  success('verifyNewsletterBlogLinks', {
    slug: issue.slug,
    checked: features.length,
    failures: failures.length,
  });
  return result;
}
