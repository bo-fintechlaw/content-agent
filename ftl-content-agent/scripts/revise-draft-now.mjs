#!/usr/bin/env node
// Trigger one full draft+judge cycle for a topic that should be revised.
// Uses LOCAL Phase 1 code (verdict.js math + corrected drafter prompt).
//
// Usage:
//   node scripts/revise-draft-now.mjs <topicId> [--max-passes 2]
//
// Sets the topic status to 'revision' so the drafter queue picks it up,
// then calls runDraftAndJudge which loops draft → prejudge → judge up to
// maxAutoPasses times. On PASS, the existing Slack flow fires.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const topicId = process.argv[2];
const maxIdx = process.argv.indexOf('--max-passes');
const maxAutoPasses = maxIdx > -1 ? Number(process.argv[maxIdx + 1]) : 2;
if (!topicId) {
  console.error('Usage: node scripts/revise-draft-now.mjs <topicId> [--max-passes N]');
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
if (!process.env.ANTHROPIC_MODEL) {
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { runDraftAndJudge } = await import('../src/pipeline/production.js');

const { data: topicPre } = await supabase
  .from('content_topics')
  .select('id, status, title')
  .eq('id', topicId)
  .maybeSingle();
if (!topicPre) {
  console.error(`Topic ${topicId} not found.`);
  process.exit(1);
}

const dash = '─'.repeat(70);
console.log(dash);
console.log(`Topic: ${topicPre.title}`);
console.log(`Status before: ${topicPre.status}  →  pushing to 'revision'`);
console.log(`maxAutoPasses: ${maxAutoPasses}`);
console.log(dash);

await supabase
  .from('content_topics')
  .update({ status: 'revision', updated_at: new Date().toISOString() })
  .eq('id', topicId);

const t0 = Date.now();
const result = await runDraftAndJudge(supabase, process.env, {
  topicId,
  maxAutoRevisionPasses: maxAutoPasses,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log();
console.log('runDraftAndJudge result:');
console.log(JSON.stringify(result, null, 2));
console.log();
console.log(`Elapsed: ${elapsed}s`);

const { data: topicPost } = await supabase
  .from('content_topics')
  .select('status')
  .eq('id', topicId)
  .maybeSingle();
console.log(`Topic status after: ${topicPost?.status}`);

const { data: latest } = await supabase
  .from('content_drafts')
  .select('id, blog_title, judge_pass, revision_count, created_at')
  .eq('topic_id', topicId)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
console.log(`Latest draft: ${latest?.id}`);
console.log(`  judge_pass=${latest?.judge_pass}, revision_count=${latest?.revision_count}`);
console.log(`  blog_title: ${latest?.blog_title}`);
