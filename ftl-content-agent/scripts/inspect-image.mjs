#!/usr/bin/env node
// Quick check of image-related fields on a draft.
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/inspect-image.mjs <draftId>');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data, error } = await supabase
  .from('content_drafts')
  .select('id, image_asset_ref, image_prompt, image_generated, blog_slug')
  .eq('id', id)
  .maybeSingle();

if (error) {
  console.error('Query error:', error.message);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
