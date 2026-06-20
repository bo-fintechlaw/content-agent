#!/usr/bin/env node
/**
 * Exercise POST /slack/interactions (local or APP_BASE_URL).
 *
 *   node --env-file=.env scripts/test-slack-interactivity.mjs url-verification
 */
import crypto from 'crypto';

const mode = process.argv[2] ?? 'url-verification';
const signingSecret = process.env.SLACK_SIGNING_SECRET;
if (!signingSecret) {
  console.error('Missing SLACK_SIGNING_SECRET');
  process.exit(1);
}

const base = (process.env.APP_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const url = `${base}/slack/interactions`;

function sign(rawBody) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(sigBase).digest('hex');
  return { timestamp, signature: `v0=${hmac}` };
}

async function runUrlVerification() {
  const challenge = 'ftl-test-challenge-' + Date.now();
  const payload = {
    type: 'url_verification',
    token: 'ignored',
    challenge,
  };
  const rawBody = JSON.stringify(payload);
  const { timestamp, signature } = sign(rawBody);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
    },
    body: rawBody,
  });

  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  console.log('POST', url);
  console.log('status:', resp.status);
  console.log('body:', body);

  if (resp.status !== 200) {
    process.exit(1);
  }
  if (body?.challenge !== challenge) {
    console.error('Expected challenge echoed back; got:', body?.challenge);
    process.exit(1);
  }
  console.log('OK — challenge echoed');
}

if (mode === 'url-verification') {
  await runUrlVerification();
} else {
  console.error(`Unknown mode: ${mode}. Try: url-verification`);
  process.exit(1);
}
