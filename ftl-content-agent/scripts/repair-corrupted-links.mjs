#!/usr/bin/env node
// Repair the `[text]([source](url))` corruption pattern in a draft's blog_body.
// This pattern was produced by the URL-rewrite regex in production.js
// normalizeBlogBody before it was fixed; the fix only prevents new corruption,
// it does not retroactively repair existing rows.
//
// Usage:
//   node scripts/repair-corrupted-links.mjs <draftId> [--dry-run]

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const draftId = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!draftId) {
  console.error('Usage: node scripts/repair-corrupted-links.mjs <draftId> [--dry-run]');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data, error } = await supabase
  .from('content_drafts')
  .select('id, blog_body')
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

// Pattern: [text]([source](url)) → [text](url)
// text: any non-`]` chars (link text from drafter, may include parens)
// url:  http(s) URL up to closing `)`
const CORRUPT_PATTERN = /\[([^\]]+)\]\(\[source\]\((https?:\/\/[^)]+)\)\)/g;

let totalReplacements = 0;
const sections = (data.blog_body || []).map((section, idx) => {
  const before = String(section?.body ?? '');
  const after = before.replace(CORRUPT_PATTERN, '[$1]($2)');
  const count = (before.match(CORRUPT_PATTERN) || []).length;
  totalReplacements += count;
  if (count > 0) {
    console.log(`Section ${idx} "${section.title}": ${count} corrupted link(s) repaired`);
  }
  return { ...section, body: after };
});

console.log();
console.log(`Total replacements: ${totalReplacements}`);

if (dryRun) {
  console.log('--dry-run set: not writing to DB.');
  console.log();
  console.log('Sample (first section, first 400 chars after repair):');
  console.log(sections[0]?.body?.slice(0, 400));
  process.exit(0);
}

if (totalReplacements === 0) {
  console.log('No corrupted patterns found. No DB write needed.');
  process.exit(0);
}

const { error: updErr } = await supabase
  .from('content_drafts')
  .update({ blog_body: sections })
  .eq('id', draftId);
if (updErr) {
  console.error('Update failed:', updErr.message);
  process.exit(1);
}
console.log(`Draft ${draftId} updated.`);
