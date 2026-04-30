#!/usr/bin/env node
/**
 * Post a one-line test message to the configured Slack channel.
 * Use this to verify SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, and that the bot is in the channel.
 *
 * The channel id must be a public/private channel id (starts with C or G), not a user id.
 * In Slack: right-click the channel → View channel details → copy Channel ID.
 *
 * Usage (from ftl-content-agent/ with .env):
 *   npm run slack:ping
 */
import 'dotenv/config';
import { WebClient } from '@slack/web-api';

function normalizeChannelId(channel) {
  const raw = String(channel ?? '').trim();
  if (/^[CG][A-Z0-9]{8,}$/i.test(raw)) return raw;
  const match = raw.match(/([CG][A-Z0-9]{8,})/i);
  if (match?.[1]) return match[1];
  return raw;
}

const token =
  process.env.SLACK_BOT_TOKEN?.trim() || process.env.BOT_USER_OAUTH_TOKEN?.trim();
const rawChannel = process.env.SLACK_CHANNEL_ID?.trim();
const channel = normalizeChannelId(rawChannel);

if (!token) {
  console.error('Missing SLACK_BOT_TOKEN (or BOT_USER_OAUTH_TOKEN) in the environment.');
  process.exit(1);
}
if (!rawChannel) {
  console.error('Missing SLACK_CHANNEL_ID in the environment.');
  process.exit(1);
}

if (!/^[CG][A-Z0-9]{8,}$/i.test(channel)) {
  console.error(
    'SLACK_CHANNEL_ID does not look like a channel id (expected C… or G…). ' +
      'Got: ' +
      channel +
      '\nUse the channel id from Slack (not a user id / DM id).'
  );
  process.exit(1);
}

const client = new WebClient(token);
const result = await client.chat.postMessage({
  channel,
  text:
    'FTL content-agent: direct Slack test. If you see this, the app can post to this channel. ' +
      `Sent at ${new Date().toISOString()}.`,
});

if (!result.ok) {
  console.error('Slack API error:', result.error);
  process.exit(1);
}

console.log('Success. channel:', channel, 'message ts:', result.ts);
console.log('Interactivity must still point at a public URL (e.g. https://<host>/slack/interactions) for Approve buttons.');
