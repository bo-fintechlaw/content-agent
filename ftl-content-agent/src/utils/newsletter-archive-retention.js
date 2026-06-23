import {
  NEWSLETTER_ARCHIVE_RETENTION_COUNT,
} from '../constants/newsletter-brand.js';
import { fail, start, success } from './logger.js';

/**
 * Prune old newsletter archive documents in Sanity after a new issue is published.
 * Keeps the newest {@link NEWSLETTER_ARCHIVE_RETENTION_COUNT} issues per segment.
 *
 * @param {import('@sanity/client').SanityClient | null | undefined} client
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ keepCount?: number }} [opts]
 * @returns {Promise<{ deleted: string[], kept: string[] }>}
 */
export async function pruneNewsletterArchivePages(client, issue, opts = {}) {
  const keepCount = opts.keepCount ?? NEWSLETTER_ARCHIVE_RETENTION_COUNT;
  if (!client) {
    return { deleted: [], kept: [] };
  }

  start('pruneNewsletterArchivePages', {
    segment: issue.segment,
    slug: issue.slug,
    keepCount,
  });

  const query = `*[_type == "newsletter" && segment == $segment && defined(issueDate)] | order(issueDate desc) {
    _id,
    "slug": slug.current,
    issueDate
  }`;

  /** @type {{ _id: string, slug: string, issueDate: string }[]} */
  const rows = await client.fetch(query, { segment: issue.segment });
  const kept = rows.slice(0, keepCount).map((row) => row.slug);
  const toDelete = rows.slice(keepCount);

  const deleted = [];
  for (const row of toDelete) {
    try {
      await client.delete(row._id);
      deleted.push(row.slug);
    } catch (err) {
      fail('pruneNewsletterArchivePages:delete', err, { slug: row.slug, id: row._id });
    }
  }

  success('pruneNewsletterArchivePages', {
    segment: issue.segment,
    deletedCount: deleted.length,
    keptCount: kept.length,
  });

  return { deleted, kept };
}
