#!/usr/bin/env node
// Re-send the Slack review message for an existing draft.
// Use this to recover from a missed/broken review post (e.g. APP_BASE_URL was
// unset on the server when the cron ran, so the preview link was suppressed).
//
// Usage:
//   node scripts/resend-review.mjs <draftId>
//   node scripts/resend-review.mjs --latest      # most recent draft in `review`
//
// Reads APP_BASE_URL, SLACK_*, SUPABASE_* from .env.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createSlackClient, sendReviewMessage } from '../src/integrations/slack.js';
import {
  computeJudgeComposite,
  deriveJudgeVerdict,
  normalizeJudgeScores,
} from '../src/pipeline/verdict.js';

dotenv.config({ override: true });

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/resend-review.mjs <draftId>|--latest');
  process.exit(1);
}

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  SLACK_BOT_TOKEN,
  BOT_USER_OAUTH_TOKEN,
  SLACK_CHANNEL_ID,
  APP_BASE_URL,
} = process.env;

const slackToken = SLACK_BOT_TOKEN?.trim() || BOT_USER_OAUTH_TOKEN?.trim();
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}
if (!slackToken || !SLACK_CHANNEL_ID) {
  console.error('Missing SLACK_BOT_TOKEN/SLACK_CHANNEL_ID in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

let draft;
if (arg === '--latest') {
  const { data: topic, error: tErr } = await supabase
    .from('content_topics')
    .select('id')
    .eq('status', 'review')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!topic) {
    console.error('No content_topics in status=review.');
    process.exit(1);
  }
  const { data, error } = await supabase
    .from('content_drafts')
    .select('id, topic_id, blog_title, blog_body, judge_scores, judge_flags, linkedin_post, x_post')
    .eq('topic_id', topic.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  draft = data;
} else {
  const { data, error } = await supabase
    .from('content_drafts')
    .select('id, topic_id, blog_title, blog_body, judge_scores, judge_flags, linkedin_post, x_post')
    .eq('id', arg)
    .maybeSingle();
  if (error) throw new Error(error.message);
  draft = data;
}

if (!draft) {
  console.error(`No draft found for ${arg}`);
  process.exit(1);
}

const scores = normalizeJudgeScores(draft.judge_scores);
const composite = computeJudgeComposite(scores);
const verdict = deriveJudgeVerdict({ composite, scores }) ?? 'PASS';

const baseUrl = String(APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
const reviewUrl = baseUrl ? `${baseUrl}/api/drafts/${draft.id}/preview` : '';

if (!reviewUrl) {
  console.error(
    'APP_BASE_URL is unset locally — preview link will be omitted. ' +
      'Set it in .env (e.g. https://ftl-content-agent-production.up.railway.app) and retry.'
  );
  process.exit(1);
}

const flags = Array.isArray(draft.judge_flags) ? draft.judge_flags : [];
const manualVerificationNotes = flags
  .filter((f) => String(f).toLowerCase().startsWith('manual_verify:'))
  .map((f) => f.replace(/^manual_verify:\s*/i, ''));
const revisionNotes = flags
  .filter((f) => String(f).toLowerCase().startsWith('revision:'))
  .map((f) => f.replace(/^revision:\s*/i, ''));

const slack = createSlackClient(slackToken);
const result = await sendReviewMessage(slack, SLACK_CHANNEL_ID, {
  draftId: draft.id,
  blog_title: draft.blog_title,
  scores,
  composite,
  verdict,
  blogBody: draft.blog_body,
  linkedinPost: draft.linkedin_post,
  xPost: draft.x_post,
  revisionNotes: revisionNotes.length ? revisionNotes : null,
  manualVerificationNotes: manualVerificationNotes.length ? manualVerificationNotes : null,
  reviewUrl,
});

if (!result?.ok) {
  console.error('Slack post failed:', result?.error ?? 'unknown');
  process.exit(1);
}

console.log('Resent draft', draft.id, '→ Slack ts', result.ts);
console.log('Preview URL:', reviewUrl);
