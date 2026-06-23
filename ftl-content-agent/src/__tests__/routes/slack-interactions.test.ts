import crypto from 'crypto';
import express from 'express';
import type { Server } from 'http';
import { createSlackWebhookRouter } from '../../routes/webhooks.js';

const signingSecret = 'test-signing-secret';
const cmoSigningSecret = 'test-cmo-signing-secret';

function sign(rawBody: string, secret = signingSecret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', secret).update(sigBase).digest('hex');
  return { timestamp, signature: `v0=${hmac}` };
}

function makeApp(overrides: Record<string, string> = {}) {
  const app = express();
  const config = {
    SLACK_SIGNING_SECRET: signingSecret,
    SLACK_CMO_SIGNING_SECRET: cmoSigningSecret,
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_CHANNEL_ID: 'C00000000',
    ...overrides,
  };
  app.use('/slack', createSlackWebhookRouter({}, config));
  return app.listen(0);
}

describe('POST /slack/interactions', () => {
  let server: Server | null = null;
  let port = 0;

  beforeAll((done) => {
    server = makeApp();
    server.on('listening', () => {
      const addr = server?.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      done();
    });
  });

  afterAll((done) => {
    server?.close(done);
  });

  it('echoes url_verification challenge for JSON body', async () => {
    const challenge = 'challenge-abc-123';
    const rawBody = JSON.stringify({
      type: 'url_verification',
      token: 'ignored',
      challenge,
    });
    const { timestamp, signature } = sign(rawBody);

    const resp = await fetch(`http://127.0.0.1:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body: rawBody,
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({ challenge });
  });

  it('handles block_actions from form-urlencoded payload', async () => {
    const payload = {
      type: 'block_actions',
      actions: [{ action_id: 'wait_for_cron', value: 'topic-id' }],
    };
    const rawBody = 'payload=' + encodeURIComponent(JSON.stringify(payload));
    const { timestamp, signature } = sign(rawBody);

    const resp = await fetch(`http://127.0.0.1:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body: rawBody,
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({ ok: true });
  });

  it('accepts block_actions signed with the CMO app secret', async () => {
    const payload = {
      type: 'block_actions',
      actions: [{ action_id: 'wait_for_cron', value: 'topic-id' }],
    };
    const rawBody = 'payload=' + encodeURIComponent(JSON.stringify(payload));
    const { timestamp, signature } = sign(rawBody, cmoSigningSecret);

    const resp = await fetch(`http://127.0.0.1:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body: rawBody,
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns 401 when signature does not match either secret', async () => {
    const payload = {
      type: 'block_actions',
      actions: [{ action_id: 'wait_for_cron', value: 'topic-id' }],
    };
    const rawBody = 'payload=' + encodeURIComponent(JSON.stringify(payload));
    const { timestamp, signature } = sign(rawBody, 'wrong-secret');

    const resp = await fetch(`http://127.0.0.1:${port}/slack/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body: rawBody,
    });

    expect(resp.status).toBe(401);
  });
});
