#!/usr/bin/env node
// Recover a prejudge-blocked draft and post the Slack review card.
// Usage:
//   node scripts/recover-topic-review.mjs <topicId>
//   node scripts/recover-topic-review.mjs --draft <draftId>

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const arg = process.argv[2];
const draftFlag = process.argv[3];
if (!arg) {
  console.error('Usage: node scripts/recover-topic-review.mjs <topicId>');
  console.error('       node scripts/recover-topic-review.mjs --draft <draftId>');
  process.exit(1);
}

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY']) {
  if (!process.env[k]) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { validateEnv } = await import('../src/config/env.js');
const config = validateEnv();
const { recoverTopicReview } = await import('../src/pipeline/production.js');

const options =
  arg === '--draft'
    ? { draftId: String(draftFlag ?? '').trim() }
    : { topicId: String(arg).trim() };

if (!options.topicId && !options.draftId) {
  console.error('Missing topicId or draftId');
  process.exit(1);
}

console.log('Recovering…', options);
const t0 = Date.now();
const result = await recoverTopicReview(supabase, config, options);
console.log(JSON.stringify(result, null, 2));
console.log(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (!result.recovered) {
  process.exit(1);
}
