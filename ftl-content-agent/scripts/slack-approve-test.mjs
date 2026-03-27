#!/usr/bin/env node
import 'dotenv/config';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const draftId = process.argv[2];
if (!draftId) {
  console.error('Usage: node scripts/slack-approve-test.mjs <draftId>');
  process.exit(1);
}

const signingSecret = process.env.SLACK_SIGNING_SECRET;
if (!signingSecret) throw new Error('Missing SLACK_SIGNING_SECRET in .env');

const payload = {
  type: 'block_actions',
  actions: [{ action_id: 'approve_draft', value: draftId }],
  // Minimal payload; our route only reads actions[0].value + actions[0].action_id.
};

const rawBody = 'payload=' + encodeURIComponent(JSON.stringify(payload));
const timestamp = Math.floor(Date.now() / 1000).toString();
const base = `v0:${timestamp}:${rawBody}`;
const hmac = crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
const signature = `v0=${hmac}`;

const url = 'http://127.0.0.1:3001/slack/interactions';

const resp = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Slack-Request-Timestamp': timestamp,
    'X-Slack-Signature': signature,
  },
  body: rawBody,
});

const bodyText = await resp.text();
console.log('slack/interactions status:', resp.status);
console.log(bodyText);

// Verify topic status in Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: draft, error: draftErr } = await supabase
  .from('content_drafts')
  .select('topic_id')
  .eq('id', draftId)
  .single();
if (draftErr) throw new Error(draftErr.message);

const { data: topic, error: topicErr } = await supabase
  .from('content_topics')
  .select('status')
  .eq('id', draft.topic_id)
  .single();
if (topicErr) throw new Error(topicErr.message);

console.log('topic status after callback:', topic?.status);

