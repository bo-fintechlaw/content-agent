#!/usr/bin/env node
// Diagnose whether the ranker ran recently and what the topic queue looks like.
// Usage: node scripts/check-ranker-status.mjs

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const now = new Date();
const startOfTodayET = new Date(
  new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
);
startOfTodayET.setHours(0, 0, 0, 0);
const startOfTodayUTC = new Date(
  startOfTodayET.toLocaleString('en-US', { timeZone: 'UTC' })
).toISOString();

console.log('─'.repeat(60));
console.log('Ranker diagnostic');
console.log('─'.repeat(60));
console.log('Now (UTC):           ', now.toISOString());
console.log('Now (ET):            ', now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
console.log('Day of week (ET):    ', now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }));
console.log('Today start (UTC≈):  ', startOfTodayUTC);
console.log();

// 1) Topics ranked today (status moved to 'ranked' or beyond, with updated_at today)
const { data: rankedToday, error: rankedErr } = await supabase
  .from('content_topics')
  .select('id, title, status, relevance_score, updated_at, created_at')
  .gte('updated_at', startOfTodayUTC)
  .in('status', ['ranked', 'drafting', 'judging', 'review', 'approved', 'published', 'rejected'])
  .order('updated_at', { ascending: false });

if (rankedErr) {
  console.error('Query failed (rankedToday):', rankedErr.message);
  process.exit(1);
}

console.log(`Topics with relevance_score touched today: ${rankedToday?.length ?? 0}`);
if (rankedToday?.length) {
  for (const t of rankedToday.slice(0, 10)) {
    console.log(
      `  [${t.status.padEnd(10)}] score=${t.relevance_score ?? 'null'} ${t.updated_at}  ${t.title.slice(0, 70)}`
    );
  }
}
console.log();

// 2) Pending queue size (waiting to be ranked)
const { count: pendingCount, error: pendingErr } = await supabase
  .from('content_topics')
  .select('id', { count: 'exact', head: true })
  .eq('status', 'pending');

if (pendingErr) {
  console.error('Query failed (pending count):', pendingErr.message);
} else {
  console.log(`Pending topics (awaiting rank): ${pendingCount}`);
}

// 3) Recently created pending topics (did the scanner run today?)
const { data: pendingRecent, error: pendingRecentErr } = await supabase
  .from('content_topics')
  .select('id, title, created_at, source_name')
  .eq('status', 'pending')
  .order('created_at', { ascending: false })
  .limit(5);

if (!pendingRecentErr && pendingRecent?.length) {
  console.log('Most recent pending topics (scanner output):');
  for (const t of pendingRecent) {
    console.log(`  ${t.created_at}  ${t.source_name ?? ''}  ${t.title.slice(0, 60)}`);
  }
}
console.log();

// 4) Most recent ranking event regardless of date
const { data: lastRanked, error: lastRankedErr } = await supabase
  .from('content_topics')
  .select('id, title, status, relevance_score, updated_at')
  .not('relevance_score', 'is', null)
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (!lastRankedErr && lastRanked) {
  const ageMs = Date.now() - new Date(lastRanked.updated_at).getTime();
  const ageHrs = (ageMs / 1000 / 60 / 60).toFixed(1);
  console.log(`Last topic ranked: ${lastRanked.updated_at} (${ageHrs}h ago)`);
  console.log(`  → "${lastRanked.title.slice(0, 60)}" score=${lastRanked.relevance_score} status=${lastRanked.status}`);
}
console.log();

// 5) Verdict
const dayET = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
console.log('─'.repeat(60));
console.log('Verdict');
console.log('─'.repeat(60));
if (rankedToday?.length) {
  console.log('✓ Ranker activity detected today.');
} else {
  console.log('✗ No ranker activity today.');
  if (dayET !== 'Monday') {
    console.log(`  Reason: scheduled cron is "0 6 * * 1" (Mondays at 6 AM ET only). Today is ${dayET}.`);
    console.log('  To run now: GET https://<railway-url>/api/rank-now');
  } else {
    console.log('  Today is Monday. The cron should have fired at 6 AM ET. Possible causes:');
    console.log('   - Server was not running at 6 AM ET');
    console.log('   - Scanner found 0 new topics (check pending count above)');
    console.log('   - Anthropic / Supabase error during run — check Railway logs');
  }
}
