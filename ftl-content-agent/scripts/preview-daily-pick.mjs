#!/usr/bin/env node
// Preview which topic the 7 AM ET daily cron will pick when it runs.
// Mirrors the queue logic in src/pipeline/drafter.js:50-69:
//   1) any topic with status='revision' (oldest first by updated_at)
//   2) else: highest relevance_score topic with status='ranked'
//      that meets DAILY_PUBLISH_MIN_RELEVANCE (default 7)

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const minFloor = Number(process.env.DAILY_PUBLISH_MIN_RELEVANCE ?? 7);

const { data: revisionTopics } = await supabase
  .from('content_topics')
  .select('id, title, status, relevance_score, source_url, updated_at')
  .eq('status', 'revision')
  .order('updated_at', { ascending: true });

const { data: rankedTopics } = await supabase
  .from('content_topics')
  .select('id, title, status, relevance_score, source_url, updated_at, created_at')
  .eq('status', 'ranked')
  .order('relevance_score', { ascending: false })
  .limit(10);

const dash = '─'.repeat(70);
console.log(dash);
console.log(`Daily 7 AM ET cron preview — DAILY_PUBLISH_MIN_RELEVANCE = ${minFloor}`);
console.log(dash);

console.log();
console.log(`Revision-status topics (would be picked FIRST): ${revisionTopics?.length ?? 0}`);
if (revisionTopics?.length) {
  for (const t of revisionTopics) {
    console.log(`  ${t.updated_at}  ${t.id}  ${t.title.slice(0, 60)}`);
  }
}

console.log();
console.log(`Ranked-status topics (top 10 by relevance_score):`);
if (!rankedTopics?.length) {
  console.log('  (none)');
} else {
  for (const t of rankedTopics) {
    const eligible = (t.relevance_score ?? 0) >= minFloor ? '✓' : '✗ below floor';
    console.log(
      `  ${eligible} score=${String(t.relevance_score).padEnd(4)} ${t.id}  ${t.title.slice(0, 60)}`
    );
  }
}

console.log();
console.log(dash);
console.log('Tomorrow at 7 AM ET, the cron will pick:');
console.log(dash);

let pick = null;
if (revisionTopics?.length) {
  pick = { ...revisionTopics[0], reason: 'oldest revision-status topic' };
} else {
  const eligible = (rankedTopics ?? []).find((t) => (t.relevance_score ?? 0) >= minFloor);
  if (eligible) {
    pick = { ...eligible, reason: `highest-relevance ranked topic >= ${minFloor}` };
  }
}

if (!pick) {
  console.log(
    'NO ELIGIBLE TOPIC. Slack will get a "no draft today" notification and the cron exits.'
  );
  console.log('Fix: add a manual topic via /api/suggest-topic, lower DAILY_PUBLISH_MIN_RELEVANCE,');
  console.log('or trigger /api/scan-now to fetch fresh RSS items, then /api/rank-now.');
} else {
  console.log(`Pick: ${pick.title}`);
  console.log(`  id            : ${pick.id}`);
  console.log(`  status        : ${pick.status}`);
  console.log(`  relevance     : ${pick.relevance_score}`);
  console.log(`  source_url    : ${pick.source_url}`);
  console.log(`  reason picked : ${pick.reason}`);
}
