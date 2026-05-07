#!/usr/bin/env node
/**
 * Backfill `published_posts_index` from already-published drafts in Supabase.
 *
 *   node scripts/backfill-prior-posts-index.mjs
 *
 * Idempotent: safe to re-run. Upserts on (draft_id) per migration 009.
 * Source of truth is `content_drafts.published_at IS NOT NULL` joined with
 * the topic's source_name + category. Drafts that were published before
 * migration 009 ran will be picked up here.
 *
 * env: SUPABASE_URL, SUPABASE_SERVICE_KEY, optional APP_BASE_URL
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { recordPublishedPost } from '../src/pipeline/prior-posts.js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Public blog domain. Override via PUBLIC_BLOG_BASE_URL if the public site
// ever moves. APP_BASE_URL points at the Railway API host (wrong for blog
// permalinks) so we don't fall back to it.
const baseUrl = (process.env.PUBLIC_BLOG_BASE_URL || 'https://fintechlaw.ai').replace(/\/+$/, '');

async function main() {
  const { data: drafts, error } = await supa
    .from('content_drafts')
    .select(
      'id, blog_title, blog_slug, blog_body, published_at, topic_id, content_topics!inner(source_name, category)'
    )
    .not('published_at', 'is', null)
    .order('published_at', { ascending: true });
  if (error) throw new Error(`Query failed: ${error.message}`);
  if (!drafts?.length) {
    console.log('No published drafts found — nothing to backfill.');
    return;
  }

  console.log(`Backfilling ${drafts.length} published drafts...`);
  let recorded = 0;
  let skipped = 0;
  let failed = 0;
  for (const draft of drafts) {
    const topic = draft.content_topics ?? {};
    const result = await recordPublishedPost(supa, {
      draft,
      topic,
      publishedAt: draft.published_at,
      appBaseUrl: baseUrl,
    });
    if (result.recorded) recorded += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
    process.stdout.write(`  ${recorded + skipped + failed}/${drafts.length}\r`);
  }
  console.log(`\nDone. recorded=${recorded} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
