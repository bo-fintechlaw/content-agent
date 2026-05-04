#!/usr/bin/env node
// Resets a draft's judge state and re-runs the judge using LOCAL code.
// Use this to recover a draft that the judge previously rejected (or set
// judge_pass) so the new judge code path can re-evaluate it. The draft
// content is NOT changed — only judge_pass / judge_scores / judge_flags
// and the topic's status are reset.
//
// Usage:
//   node scripts/rejudge-draft.mjs <draftId>

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const draftId = process.argv[2];
if (!draftId) {
  console.error('Usage: node scripts/rejudge-draft.mjs <draftId>');
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

const { data: draft, error: dErr } = await supabase
  .from('content_drafts')
  .select('id, topic_id, judge_pass, judge_scores, judge_flags, revision_count, blog_title')
  .eq('id', draftId)
  .maybeSingle();
if (dErr) throw new Error(dErr.message);
if (!draft) {
  console.error(`Draft ${draftId} not found.`);
  process.exit(1);
}

const { data: topic } = await supabase
  .from('content_topics')
  .select('id, status, title')
  .eq('id', draft.topic_id)
  .maybeSingle();

console.log('─'.repeat(72));
console.log(`Draft:  ${draft.id}`);
console.log(`Title:  ${draft.blog_title || '(none)'}`);
console.log(`Topic:  ${draft.topic_id}  •  status=${topic?.status}`);
console.log(`Before: judge_pass=${draft.judge_pass}  revisions=${draft.revision_count}`);
console.log('─'.repeat(72));

// Reset the draft's judge state so runJudging will actually evaluate it.
// Keep blog_body / blog_title / etc unchanged — this is purely a re-judge.
await supabase
  .from('content_drafts')
  .update({
    judge_pass: null,
    judge_scores: null,
    judge_flags: [],
  })
  .eq('id', draftId);

// Topic must not be in 'rejected' state for the judge to run on it.
await supabase
  .from('content_topics')
  .update({ status: 'judging', updated_at: new Date().toISOString() })
  .eq('id', draft.topic_id);

console.log('Reset complete. Running judge…');
console.log();

const { runJudging } = await import('../src/pipeline/judge.js');
const result = await runJudging(supabase, process.env, { draftId });

console.log();
console.log('runJudging result:');
console.log(JSON.stringify(result, null, 2));

const { data: post } = await supabase
  .from('content_drafts')
  .select('judge_pass, judge_scores, judge_flags, revision_count')
  .eq('id', draftId)
  .maybeSingle();
const { data: topicPost } = await supabase
  .from('content_topics')
  .select('status')
  .eq('id', draft.topic_id)
  .maybeSingle();

console.log();
console.log('─'.repeat(72));
console.log(`After:  judge_pass=${post?.judge_pass}  revisions=${post?.revision_count}`);
console.log(`Topic:  status=${topicPost?.status}`);
console.log('─'.repeat(72));
console.log('Check Slack — the new judge code path posts a reviewable message');
console.log('with Approve / Request Changes / Reject buttons on every verdict.');
