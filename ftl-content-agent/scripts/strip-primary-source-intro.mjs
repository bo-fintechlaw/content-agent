#!/usr/bin/env node
// One-shot cleanup for an existing draft: strip the duplicated
// "Primary source: [Original report](url)" line that the prejudge backstop
// injected into the opening section before the duplicate-citation fix landed.
//
// Usage:
//   node scripts/strip-primary-source-intro.mjs <draftId>

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/strip-primary-source-intro.mjs <draftId>');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data: draft, error } = await supabase
  .from('content_drafts')
  .select('id, blog_body')
  .eq('id', id)
  .maybeSingle();

if (error) throw new Error(error.message);
if (!draft) {
  console.error('Draft not found');
  process.exit(1);
}

const sections = Array.isArray(draft.blog_body) ? draft.blog_body : [];
if (!sections.length) {
  console.log('No sections to clean.');
  process.exit(0);
}

// Drop the injected "Primary source: [Original report](url)" line from the
// opening section. Match the exact format produced by the prior backstop.
const STRIP_RE = /\n*Primary source:\s*\[Original report\]\(https?:\/\/[^)]+\)\.?\s*$/;

const first = sections[0];
const before = String(first?.body ?? '');
const after = before.replace(STRIP_RE, '').trimEnd();

if (after === before) {
  console.log('No injected primary-source line found in the opening section.');
  process.exit(0);
}

const updated = [{ ...first, body: after }, ...sections.slice(1)];

const { error: upErr } = await supabase
  .from('content_drafts')
  .update({ blog_body: updated })
  .eq('id', id);

if (upErr) throw new Error(upErr.message);

console.log('Stripped duplicated primary-source line from opening of', id);
console.log('Removed length:', before.length - after.length, 'chars');
