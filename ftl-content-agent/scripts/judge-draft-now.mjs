#!/usr/bin/env node
// Run the judge on a specific draft using LOCAL code (i.e. Phase 1 verdict.js
// math). Calls the production Supabase + Anthropic + Slack via the same env
// the deployed app uses.
//
// Usage:
//   node scripts/judge-draft-now.mjs <draftId> [--no-revise-loop]
//
// When --no-revise-loop is set, a REVISE verdict will NOT push the topic back
// to status='revision' (the drafter cron would otherwise pick it up and create
// another draft). The judge_scores + judge_flags are still written.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const draftId = process.argv[2];
const noReviseLoop = process.argv.includes('--no-revise-loop');
if (!draftId) {
  console.error('Usage: node scripts/judge-draft-now.mjs <draftId> [--no-revise-loop]');
  process.exit(1);
}

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'ANTHROPIC_API_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}
// Match the default in src/config/env.js
if (!process.env.ANTHROPIC_MODEL) {
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// If --no-revise-loop, snapshot topic status before, then restore after if the
// judge pushed it to 'revision'.
const { runJudging } = await import('../src/pipeline/judge.js');

const { data: pre } = await supabase
  .from('content_drafts')
  .select('id, topic_id, judge_pass, revision_count')
  .eq('id', draftId)
  .maybeSingle();
if (!pre) {
  console.error(`Draft ${draftId} not found.`);
  process.exit(1);
}
const topicId = pre.topic_id;
const { data: topicPre } = await supabase
  .from('content_topics')
  .select('id, status')
  .eq('id', topicId)
  .maybeSingle();
const preStatus = topicPre?.status;

console.log('─'.repeat(70));
console.log(`Judging draft ${draftId} with LOCAL Phase 1 code`);
console.log(`Topic ${topicId} status before: ${preStatus}`);
console.log(`Draft revision_count before: ${pre.revision_count}, judge_pass before: ${pre.judge_pass}`);
console.log('─'.repeat(70));

const result = await runJudging(supabase, process.env, { draftId });
console.log();
console.log('runJudging result:');
console.log(JSON.stringify(result, null, 2));

if (noReviseLoop && result.revised) {
  console.log();
  console.log('--no-revise-loop set: restoring topic status to bypass drafter pickup');
  await supabase
    .from('content_topics')
    .update({ status: preStatus, updated_at: new Date().toISOString() })
    .eq('id', topicId);
  // Also reset revision_count so we can re-test if needed
  await supabase
    .from('content_drafts')
    .update({ revision_count: pre.revision_count })
    .eq('id', draftId);
  console.log(`Topic ${topicId} status restored to "${preStatus}".`);
}

const { data: post } = await supabase
  .from('content_drafts')
  .select('judge_pass, revision_count')
  .eq('id', draftId)
  .maybeSingle();
const { data: topicPost } = await supabase
  .from('content_topics')
  .select('status')
  .eq('id', topicId)
  .maybeSingle();
console.log();
console.log(`Draft after: judge_pass=${post?.judge_pass}, revision_count=${post?.revision_count}`);
console.log(`Topic after: status=${topicPost?.status}`);
