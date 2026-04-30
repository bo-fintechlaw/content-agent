#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const draftId = process.argv[2];
if (!draftId) {
  console.error('Usage: node scripts/dump-draft-body.mjs <draftId>');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data, error } = await supabase
  .from('content_drafts')
  .select('id, blog_title, blog_body, image_asset_ref, image_generated')
  .eq('id', draftId)
  .maybeSingle();

if (error) {
  console.error(error.message);
  process.exit(1);
}
if (!data) {
  console.error('Draft not found');
  process.exit(1);
}

console.log(`Draft: ${data.id}`);
console.log(`Title: ${data.blog_title}`);
console.log(`image_asset_ref: ${data.image_asset_ref}`);
console.log(`image_generated: ${data.image_generated}`);
console.log();

for (let i = 0; i < (data.blog_body || []).length; i++) {
  const s = data.blog_body[i];
  console.log('='.repeat(70));
  console.log(`Section ${i}: ${s.title}`);
  console.log('='.repeat(70));
  // Print body with explicit newline visualization
  console.log(JSON.stringify(s.body));
  console.log('---raw rendering---');
  console.log(s.body);
  console.log();
}
