#!/usr/bin/env node
// Halt a pending full re-draft by flipping the topic status from `revision`
// back to `review`. The drafter cron only picks up rows in status `ranked`
// or `revision`, so this stops the next tick from regenerating the article
// while leaving the existing draft + human_feedback flag in place for a
// future targeted reviser to consume.
//
// Usage:
//   node scripts/halt-pending-redraft.mjs <topicId>

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const topicId = process.argv[2];
if (!topicId) {
  console.error('Usage: node scripts/halt-pending-redraft.mjs <topicId>');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data: before, error: bErr } = await supabase
  .from('content_topics')
  .select('id, title, status, updated_at')
  .eq('id', topicId)
  .maybeSingle();
if (bErr) throw new Error(bErr.message);
if (!before) {
  console.error('Topic not found');
  process.exit(1);
}

console.log(`Before: status=${before.status}, updated_at=${before.updated_at}`);

if (before.status !== 'revision') {
  console.log(`Status is "${before.status}" (not "revision") — nothing to halt.`);
  process.exit(0);
}

const { error: upErr } = await supabase
  .from('content_topics')
  .update({ status: 'review', updated_at: new Date().toISOString() })
  .eq('id', topicId);
if (upErr) throw new Error(upErr.message);

const { data: after } = await supabase
  .from('content_topics')
  .select('status, updated_at')
  .eq('id', topicId)
  .maybeSingle();

console.log(`After:  status=${after.status}, updated_at=${after.updated_at}`);
console.log('The 15-min drafter tick will skip this topic.');
