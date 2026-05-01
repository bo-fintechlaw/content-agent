#!/usr/bin/env node
// Run the full draft+judge cycle on a specific topic using LOCAL code.
// Unlike revise-draft-now.mjs, this does NOT change the topic's status
// (works on 'ranked' or 'revision' topics as-is).
//
// Usage:
//   node scripts/draft-and-judge-now.mjs <topicId> [--max-passes 2]

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const topicId = process.argv[2];
const maxIdx = process.argv.indexOf('--max-passes');
const maxAutoPasses = maxIdx > -1 ? Number(process.argv[maxIdx + 1]) : 2;
if (!topicId) {
  console.error('Usage: node scripts/draft-and-judge-now.mjs <topicId> [--max-passes N]');
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
if (!process.env.ANTHROPIC_MODEL) process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { runDraftAndJudge } = await import('../src/pipeline/production.js');

const { data: topic } = await supabase
  .from('content_topics')
  .select('id,title,status,relevance_score,source_url')
  .eq('id', topicId)
  .maybeSingle();
if (!topic) { console.error(`Topic ${topicId} not found`); process.exit(1); }

console.log('─'.repeat(70));
console.log(`Topic: ${topic.title}`);
console.log(`Status: ${topic.status}  Score: ${topic.relevance_score}`);
console.log(`Source: ${topic.source_url}`);
console.log(`maxAutoPasses: ${maxAutoPasses}`);
console.log('─'.repeat(70));

const t0 = Date.now();
const result = await runDraftAndJudge(supabase, process.env, {
  topicId,
  maxAutoRevisionPasses: maxAutoPasses,
});
console.log();
console.log('Result:');
console.log(JSON.stringify(result, null, 2));
console.log();
console.log(`Elapsed: ${((Date.now()-t0)/1000).toFixed(1)}s`);

const { data: latest } = await supabase
  .from('content_drafts')
  .select('id, blog_title, judge_pass, revision_count, judge_flags')
  .eq('topic_id', topicId)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
console.log();
console.log(`Latest draft: ${latest?.id}`);
console.log(`  judge_pass=${latest?.judge_pass}, revision_count=${latest?.revision_count}`);
console.log(`  blog_title: ${latest?.blog_title}`);
const warnings = (latest?.judge_flags ?? []).filter(f => typeof f === 'string' && f.startsWith('prejudge_warning:'));
if (warnings.length) {
  console.log(`  prejudge warnings (manual verify): ${warnings.length}`);
  for (const w of warnings) console.log(`    - ${w}`);
}
