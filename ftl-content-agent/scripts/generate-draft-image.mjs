#!/usr/bin/env node
// Generate a featured image for an existing draft (using its image_prompt)
// and persist the resulting Sanity asset reference to content_drafts.
//
// Usage:
//   node scripts/generate-draft-image.mjs <draftId>

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createSanityClient } from '../src/integrations/sanity.js';
import { generateAndUploadImage } from '../src/integrations/image-generator.js';

dotenv.config({ override: true });

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/generate-draft-image.mjs <draftId>');
  process.exit(1);
}

const xaiKey = (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
if (!xaiKey) {
  console.error('Missing XAI_API_KEY (or GROK_API_KEY) in .env');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data: draft, error } = await supabase
  .from('content_drafts')
  .select('id, image_asset_ref, image_prompt, blog_slug')
  .eq('id', id)
  .maybeSingle();

if (error) throw new Error(error.message);
if (!draft) {
  console.error('Draft not found');
  process.exit(1);
}
if (draft.image_asset_ref) {
  console.log('image_asset_ref already set:', draft.image_asset_ref);
  process.exit(0);
}
if (!draft.image_prompt) {
  console.error('Draft has no image_prompt — drafter never produced one');
  process.exit(1);
}

const sanityClient = createSanityClient({
  SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
  SANITY_DATASET: process.env.SANITY_DATASET,
  SANITY_API_TOKEN: process.env.SANITY_API_TOKEN,
});

const slugPart = String(draft.blog_slug || 'blog').slice(0, 40);
const ref = await generateAndUploadImage({
  prompt: draft.image_prompt,
  sanityClient,
  xaiApiKey: xaiKey,
  filename: `${slugPart}.png`,
});

if (!ref?._ref) {
  console.error('Image generation failed (see prior fail() log).');
  process.exit(1);
}

const { error: upErr } = await supabase
  .from('content_drafts')
  .update({ image_asset_ref: ref._ref, image_generated: true })
  .eq('id', id);

if (upErr) throw new Error(upErr.message);

console.log('Saved image_asset_ref:', ref._ref);
