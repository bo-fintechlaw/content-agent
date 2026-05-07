/**
 * Prior-posts index — read/write for the published-corpus FTS table.
 *
 * The drafter consults `findRelatedPriorPosts` to discover earlier FTL posts
 * that overlap the new topic. The publisher calls `recordPublishedPost`
 * after a successful Sanity publish so future drafts can find this one.
 *
 * Implementation notes (FTL_Editorial_Intelligence_v1.md §2.3):
 * - Postgres FTS via the `search_tsv` generated column on the
 *   `published_posts_index` table. No embeddings, no extra dependency.
 * - Upgrades to pgvector embeddings once the corpus passes ~500 posts or
 *   non-lexical similarity matters; that's a Phase-3 concern.
 */

import { fail, start, success } from '../utils/logger.js';

// Public blog domain — fixed to fintechlaw.ai (Sanity → Netlify build target).
// We deliberately do NOT default to APP_BASE_URL because that points at the
// Railway API host, not the published blog. Override via the explicit
// `appBaseUrl` arg if the public site domain ever moves.
const PUBLIC_BLOG_BASE_URL = 'https://fintechlaw.ai';

/**
 * Insert or update an entry for a freshly-published draft. Idempotent on
 * (draft_id) per the unique index in migration 009.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   draft: { id: string, blog_title?: string, blog_slug?: string, blog_body?: any },
 *   topic: { source_name?: string|null, category?: string|null },
 *   publishedAt: string,
 *   appBaseUrl?: string,
 * }} args
 */
export async function recordPublishedPost(supabase, args) {
  start('recordPublishedPost', { draftId: args?.draft?.id });
  try {
    const { draft, topic = {}, publishedAt, appBaseUrl } = args ?? {};
    if (!draft?.id || !draft?.blog_slug) {
      // Missing slug means we can't build a stable canonical URL — silently skip.
      return { skipped: true, reason: 'missing_id_or_slug' };
    }
    const baseUrl = String(appBaseUrl ?? PUBLIC_BLOG_BASE_URL).replace(/\/+$/, '');
    const publishedUrl = `${baseUrl}/blog/${draft.blog_slug}`;
    const firstParagraph = extractFirstParagraph(draft.blog_body);

    const row = {
      draft_id: draft.id,
      published_url: publishedUrl,
      blog_title: String(draft.blog_title ?? '').slice(0, 500),
      blog_slug: String(draft.blog_slug ?? '').slice(0, 200),
      category: topic.category ?? null,
      source_name: topic.source_name ?? null,
      first_paragraph: firstParagraph,
      published_at: publishedAt ?? new Date().toISOString(),
    };

    const { error } = await supabase
      .from('published_posts_index')
      .upsert(row, { onConflict: 'draft_id' });
    if (error) throw new Error(error.message);

    success('recordPublishedPost', { draftId: draft.id, publishedUrl });
    return { recorded: true, publishedUrl };
  } catch (err) {
    // Best-effort — never block the publish path on an index-write error.
    // Log and return so the publisher can continue.
    fail('recordPublishedPost', err, { draftId: args?.draft?.id });
    return { recorded: false, error: err?.message ?? String(err) };
  }
}

/**
 * FTS query against the published-posts index. Returns up to `limit` posts
 * whose title + first paragraph best match the topic title + summary.
 * Falls back to an empty list on any query error so the drafter is never
 * blocked by index issues.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   topic: { title?: string|null, summary?: string|null },
 *   limit?: number,
 *   excludeDraftId?: string|null,
 * }} args
 * @returns {Promise<Array<{
 *   blog_title: string, published_url: string, blog_slug: string,
 *   first_paragraph: string|null, category: string|null,
 *   published_at: string,
 * }>>}
 */
export async function findRelatedPriorPosts(supabase, args) {
  const { topic, limit = 3, excludeDraftId = null } = args ?? {};
  const queryText = buildFtsQuery(topic);
  if (!queryText) return [];

  try {
    let q = supabase
      .from('published_posts_index')
      .select(
        'draft_id, blog_title, blog_slug, published_url, first_paragraph, category, published_at'
      )
      .textSearch('search_tsv', queryText, { type: 'websearch', config: 'english' })
      .order('published_at', { ascending: false })
      .limit(Math.max(1, Math.min(10, limit)));
    if (excludeDraftId) q = q.neq('draft_id', excludeDraftId);
    const { data, error } = await q;
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Build a Postgres `websearch_to_tsquery`-compatible query string from the
 * topic. We intentionally favour title terms — they're the strongest signal
 * for "is this the same regulator action / story." Stopwords and short
 * tokens are filtered to avoid matching every post.
 */
function buildFtsQuery(topic) {
  const title = String(topic?.title ?? '').trim();
  const summary = String(topic?.summary ?? '').trim();
  const raw = `${title} ${summary}`;
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .filter((t) => !STOPWORDS.has(t));
  // Dedup, keep first 8 (websearch tsquery handles AND between bare terms).
  const uniq = Array.from(new Set(tokens)).slice(0, 8);
  return uniq.join(' ');
}

/**
 * Pull the first ~600 chars of the first body section. blog_body is a JSONB
 * array of `{title, body}` objects per migration 002.
 */
function extractFirstParagraph(blogBody) {
  if (!Array.isArray(blogBody)) return null;
  for (const section of blogBody) {
    const body = String(section?.body ?? '').trim();
    if (body.length >= 80) return body.slice(0, 600);
  }
  return null;
}

const STOPWORDS = new Set([
  'about','after','again','against','also','among','because','been','being',
  'between','both','could','does','doing','during','each','from','further',
  'have','having','here','into','itself','more','most','only','other','over',
  'same','should','some','such','than','that','their','them','then','there',
  'these','they','this','those','through','under','until','very','were','what',
  'when','where','which','while','will','with','would','your','yours',
]);
