#!/usr/bin/env node
// Check whether the 7 AM ET daily cron fired today.
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const now = new Date();
const todayET = new Date(
  new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
);
todayET.setHours(0, 0, 0, 0);
const startOfTodayUTC = new Date(
  todayET.toLocaleString('en-US', { timeZone: 'UTC' })
).toISOString();

console.log('Now (UTC):', now.toISOString());
console.log('Now (ET):', now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
console.log('Start of today ET (UTC):', startOfTodayUTC);
console.log();

// 1) Drafts created today
const { data: draftsToday } = await supabase
  .from('content_drafts')
  .select('id, topic_id, blog_title, judge_pass, revision_count, created_at')
  .gte('created_at', startOfTodayUTC)
  .order('created_at', { ascending: true });
console.log(`Drafts created today: ${draftsToday?.length ?? 0}`);
for (const d of draftsToday ?? []) {
  console.log(`  ${d.created_at}  pass=${d.judge_pass}  rev=${d.revision_count}  ${d.blog_title?.slice(0, 60)}`);
}

// 2) Topics whose status changed today
const { data: topicsToday } = await supabase
  .from('content_topics')
  .select('id, title, status, relevance_score, updated_at')
  .gte('updated_at', startOfTodayUTC)
  .order('updated_at', { ascending: true });
console.log();
console.log(`Topics with updated_at today: ${topicsToday?.length ?? 0}`);
for (const t of topicsToday ?? []) {
  console.log(`  ${t.updated_at}  [${t.status.padEnd(10)}] score=${t.relevance_score} ${t.title?.slice(0, 60)}`);
}

// 3) Specific check on the DeFi revision topic
console.log();
const { data: defi } = await supabase
  .from('content_topics')
  .select('*')
  .eq('id', '99ee7717-06f9-4934-9910-f2e5ddb26109')
  .maybeSingle();
console.log('DeFi revision topic 99ee7717:');
console.log(`  status: ${defi?.status}`);
console.log(`  updated_at: ${defi?.updated_at}`);

// 4) Most recent draft regardless of date
const { data: latest } = await supabase
  .from('content_drafts')
  .select('id, blog_title, created_at')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
console.log();
console.log(`Most recent draft anywhere: ${latest?.created_at} - ${latest?.blog_title?.slice(0, 60)}`);
const ageHrs = ((Date.now() - new Date(latest?.created_at).getTime()) / 1000 / 60 / 60).toFixed(1);
console.log(`  Age: ${ageHrs} hours ago`);
