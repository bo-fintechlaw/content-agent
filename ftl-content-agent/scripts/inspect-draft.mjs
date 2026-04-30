#!/usr/bin/env node
// Diagnose why a specific draft did or did not auto-revise.
// Usage:
//   node scripts/inspect-draft.mjs <draftId> [topicId]
// Prints status, revision_count, judge_pass, judge_flags, judge_scores, and
// timestamps for the topic + draft so you can tell which gate stopped the loop.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const draftId = process.argv[2];
const topicIdArg = process.argv[3];
if (!draftId) {
  console.error('Usage: node scripts/inspect-draft.mjs <draftId> [topicId]');
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const { data: draft, error: draftErr } = await supabase
  .from('content_drafts')
  .select(
    'id, topic_id, blog_title, judge_pass, judge_scores, judge_flags, revision_count, sanity_document_id, created_at, published_at'
  )
  .eq('id', draftId)
  .maybeSingle();

if (draftErr) {
  console.error('Draft query failed:', draftErr.message);
  process.exit(1);
}
if (!draft) {
  console.error(`No draft found with id ${draftId}`);
  process.exit(1);
}

const topicId = topicIdArg || draft.topic_id;
const { data: topic, error: topicErr } = await supabase
  .from('content_topics')
  .select('id, title, status, relevance_score, suggested_by, source_url, created_at, updated_at')
  .eq('id', topicId)
  .maybeSingle();

if (topicErr) {
  console.error('Topic query failed:', topicErr.message);
  process.exit(1);
}

// All drafts for the same topic (revision history)
const { data: siblingDrafts } = await supabase
  .from('content_drafts')
  .select('id, judge_pass, revision_count, created_at')
  .eq('topic_id', topicId)
  .order('created_at', { ascending: true });

const dash = '─'.repeat(70);
console.log(dash);
console.log('TOPIC');
console.log(dash);
if (topic) {
  console.log(`id              : ${topic.id}`);
  console.log(`title           : ${topic.title}`);
  console.log(`status          : ${topic.status}`);
  console.log(`relevance_score : ${topic.relevance_score}`);
  console.log(`suggested_by    : ${topic.suggested_by}`);
  console.log(`source_url      : ${topic.source_url}`);
  console.log(`created_at      : ${topic.created_at}`);
  console.log(`updated_at      : ${topic.updated_at}`);
} else {
  console.log(`(no topic found for id ${topicId})`);
}

console.log();
console.log(dash);
console.log('DRAFT');
console.log(dash);
console.log(`id                  : ${draft.id}`);
console.log(`blog_title          : ${draft.blog_title}`);
console.log(`judge_pass          : ${draft.judge_pass}`);
console.log(`revision_count      : ${draft.revision_count}`);
console.log(`sanity_document_id  : ${draft.sanity_document_id}`);
console.log(`created_at          : ${draft.created_at}`);
console.log(`published_at        : ${draft.published_at}`);
console.log();
console.log('judge_scores:');
console.log(JSON.stringify(draft.judge_scores, null, 2));
console.log();
console.log('judge_flags:');
console.log(JSON.stringify(draft.judge_flags, null, 2));

console.log();
console.log(dash);
console.log('SIBLING DRAFTS (all drafts for the same topic, oldest first)');
console.log(dash);
for (const d of siblingDrafts ?? []) {
  const marker = d.id === draftId ? ' ← this' : '';
  console.log(
    `  ${d.created_at}  judge_pass=${d.judge_pass}  rev_count=${d.revision_count}  ${d.id}${marker}`
  );
}

console.log();
console.log(dash);
console.log('DIAGNOSIS');
console.log(dash);

const flags = Array.isArray(draft.judge_flags) ? draft.judge_flags : [];
const humanFeedbackFlags = flags.filter((f) =>
  String(f).toLowerCase().startsWith('human_feedback:')
);
const revisionFlags = flags.filter((f) => String(f).toLowerCase().startsWith('revision:'));

if (draft.revision_count >= 1) {
  console.log(
    '⚠ revision_count is at the cap (>=1). The auto-revision loop in judge.js'
  );
  console.log('  only revises when revision_count < 1. After the first auto-revise,');
  console.log('  any subsequent REVISE verdict is forwarded to Slack instead of looped.');
}

if (topic?.status && !['revision', 'drafting', 'judging'].includes(topic.status)) {
  console.log(
    `⚠ Topic status is "${topic.status}" — drafter only picks up rows in status ` +
      '"ranked" or "revision". A status of "review" / "approved" / "published" means ' +
      'the row is past the auto-revision window.'
  );
}

if (revisionFlags.length) {
  console.log(`✓ ${revisionFlags.length} judge revision instruction(s) recorded in judge_flags:`);
  for (const f of revisionFlags) console.log(`  - ${f}`);
}

if (humanFeedbackFlags.length) {
  console.log(`✓ ${humanFeedbackFlags.length} human-feedback flag(s) recorded:`);
  for (const f of humanFeedbackFlags) console.log(`  - ${f}`);
} else if (topic?.status === 'revision') {
  console.log(
    '⚠ Topic is in "revision" status but no judge_flags entry starts with "human_feedback:".'
  );
  console.log(
    '  drafter.js looks for that prefix when picking revision instructions; without it,'
  );
  console.log('  it falls back to using all judge_flags as instructions.');
}

if (draft.judge_pass === false && (draft.revision_count ?? 0) === 0) {
  console.log(
    '⚠ judge_pass=false but revision_count=0 — the judge did NOT auto-revise this row,'
  );
  console.log('  even though revision_count was below the cap. Likely causes:');
  console.log('   • Verdict was not "REVISE" (was REJECT? was PASS=false but treated as such?)');
  console.log('   • Pre-judge gate ran and set judge_pass=false directly (see prejudge: flags)');
}
