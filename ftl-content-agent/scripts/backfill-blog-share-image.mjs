#!/usr/bin/env node
/**
 * Generate a Grok Imagine image from `content_drafts.image_prompt` and set `shareImage`
 * on the already-published Sanity blog. Use when XAI was missing on first publish
 * or generation failed.
 *
 *   DRAFT_ID=uuid node scripts/backfill-blog-share-image.mjs
 *   # If DRAFT_ID is omitted, uses the most recent published draft (has sanity_document_id).
 *   # env: SUPABASE_*, SANITY_*, XAI_API_KEY or GROK_API_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { xaiKeyFromProcessEnv } from '../src/config/env.js';
import { createSanityClient, patchPublishedShareImage } from '../src/integrations/sanity.js';

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const explicitId = process.env.DRAFT_ID?.trim();
let row;
let error;

if (explicitId) {
  ({ data: row, error } = await supa
    .from('content_drafts')
    .select('id, image_prompt, blog_slug, sanity_document_id')
    .eq('id', explicitId)
    .single());
} else {
  ({ data: row, error } = await supa
    .from('content_drafts')
    .select('id, image_prompt, blog_slug, sanity_document_id, published_at')
    .not('sanity_document_id', 'is', null)
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}

if (error) throw error;
if (!row?.sanity_document_id) {
  throw new Error(
    explicitId
      ? 'No sanity_document_id for draft ' + explicitId
      : 'No published draft with a Sanity document id found'
  );
}
if (!row?.image_prompt?.trim()) throw new Error('No image_prompt on draft ' + row.id);
console.log('Using draft', row.id, row.blog_slug);

const xai = xaiKeyFromProcessEnv();
const config = {
  SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
  SANITY_DATASET: process.env.SANITY_DATASET,
  SANITY_API_TOKEN: process.env.SANITY_API_TOKEN,
  SANITY_SCHEMA_ID: process.env.SANITY_SCHEMA_ID || 'placeholder',
  XAI_API_KEY: xai,
};

const sanity = createSanityClient(config);
await patchPublishedShareImage(sanity, config, {
  publishedId: String(row.sanity_document_id).trim(),
  imagePrompt: row.image_prompt,
  blogSlug: row.blog_slug,
});
console.log('Patched shareImage for Sanity id', row.sanity_document_id);

if (process.env.NETLIFY_BUILD_HOOK) {
  try {
    await axios.post(process.env.NETLIFY_BUILD_HOOK);
    console.log('Netlify build triggered');
  } catch (e) {
    console.warn('Netlify hook failed (non-fatal):', e.message);
  }
}
