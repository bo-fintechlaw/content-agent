#!/usr/bin/env node
/**
 * Backfill `published_posts_index` from Sanity.
 *
 *   node scripts/backfill-prior-posts-from-sanity.mjs
 *   node scripts/backfill-prior-posts-from-sanity.mjs --dry-run
 *
 * The companion script (`backfill-prior-posts-index.mjs`) populates the index
 * from Supabase drafts that already went through the agent pipeline. This
 * script covers the rest: blog posts published directly to Sanity (manual
 * or pre-agent) that have no `content_drafts` row.
 *
 * Idempotent: upserts on the `blog_slug` unique index from migration 012, so
 * a re-run leaves agent-recorded rows alone and only inserts new Sanity-only
 * permalinks. `draft_id` is left NULL on Sanity-only rows.
 *
 * env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SANITY_PROJECT_ID, SANITY_DATASET,
 *      SANITY_API_TOKEN, optional PUBLIC_BLOG_BASE_URL (default
 *      https://fintechlaw.ai).
 */
import 'dotenv/config';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient as createSanityClient } from '@sanity/client';

const dryRun = process.argv.includes('--dry-run');

const supa = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const sanity = createSanityClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  apiVersion: '2025-02-19',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

const baseUrl = (process.env.PUBLIC_BLOG_BASE_URL || 'https://fintechlaw.ai').replace(
  /\/+$/,
  ''
);

// GROQ: published blog posts only — exclude `drafts.*` ids and require both
// a slug and a publishedAt. Pull the first three blocks of mainContent so we
// can extract a usable first_paragraph without bloating the response.
const QUERY = `*[_type == "blog" && !(_id in path("drafts.**")) && defined(slug.current) && defined(publishedAt)]{
  _id,
  title,
  "slug": slug.current,
  publishedAt,
  category,
  "preview": mainContent[0..3]
} | order(publishedAt asc)`;

// Sanity's `mainContent` for a blog post is an array of either bare portable
// text blocks (older posts) or `pageComponentObject` wrappers whose `body`
// field contains the actual blocks (newer posts). Flatten both shapes into
// a single block stream, then return the first body block whose plain-text
// content is >= 80 chars (the same heuristic that prior-posts.js uses on
// the agent-side extractor).
function flattenToBlocks(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    if (!item) continue;
    if (item._type === 'block') {
      out.push(item);
    } else if (Array.isArray(item.body)) {
      for (const inner of item.body) {
        if (inner?._type === 'block') out.push(inner);
      }
    }
  }
  return out;
}

function blockText(block) {
  return (Array.isArray(block?.children) ? block.children : [])
    .map((c) => String(c?.text ?? ''))
    .join('')
    .trim();
}

function extractFirstParagraph(items) {
  const blocks = flattenToBlocks(items);
  // Prefer a "normal"-style paragraph block over a heading. Headings make
  // bad first-paragraph snippets and pollute the FTS rank.
  for (const block of blocks) {
    if ((block.style ?? 'normal') !== 'normal') continue;
    const text = blockText(block);
    if (text.length >= 80) return text.slice(0, 600);
  }
  // Fallback: any block, any style, length >= 40 — better than nothing.
  for (const block of blocks) {
    const text = blockText(block);
    if (text.length >= 40) return text.slice(0, 600);
  }
  return null;
}

async function main() {
  console.log(`Fetching published posts from Sanity (project=${process.env.SANITY_PROJECT_ID}, dataset=${process.env.SANITY_DATASET})...`);
  const posts = await sanity.fetch(QUERY);
  console.log(`Sanity returned ${posts.length} published posts.`);

  // Map of existing slugs in our index — both agent-recorded and any prior
  // Sanity backfill — so we can summarize the work plan before writing.
  const { data: existing, error: exErr } = await supa
    .from('published_posts_index')
    .select('blog_slug, draft_id');
  if (exErr) throw new Error(`Index read failed: ${exErr.message}`);
  const existingSlugs = new Set((existing ?? []).map((r) => r.blog_slug));

  let toInsert = 0;
  let alreadyPresent = 0;
  const rows = [];
  for (const post of posts) {
    if (!post.slug) continue;
    if (existingSlugs.has(post.slug)) {
      alreadyPresent += 1;
      continue;
    }
    rows.push({
      draft_id: null,
      published_url: `${baseUrl}/blog/${post.slug}`,
      blog_title: String(post.title ?? '').slice(0, 500) || '(untitled)',
      blog_slug: String(post.slug).slice(0, 200),
      category: post.category ?? null,
      source_name: null,
      first_paragraph: extractFirstParagraph(post.preview),
      published_at: post.publishedAt,
    });
    toInsert += 1;
  }

  console.log(
    `Plan: ${toInsert} new Sanity-only rows to insert; ${alreadyPresent} already present.`
  );

  if (dryRun) {
    console.log('Dry run — no writes. Sample row:');
    console.log(JSON.stringify(rows[0] ?? null, null, 2));
    return;
  }

  if (!rows.length) {
    console.log('Nothing to insert. Done.');
    return;
  }

  // Upsert on blog_slug (migration 012). ignoreDuplicates: true means an
  // existing slug — whether agent-recorded or prior backfill — is left
  // untouched, which is what we want here.
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supa
      .from('published_posts_index')
      .upsert(slice, { onConflict: 'blog_slug', ignoreDuplicates: true });
    if (error) throw new Error(`Insert batch failed: ${error.message}`);
    inserted += slice.length;
    process.stdout.write(`  ${inserted}/${rows.length}\r`);
  }
  console.log(`\nDone. inserted_or_skipped=${inserted}`);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
