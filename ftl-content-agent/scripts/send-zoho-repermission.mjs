#!/usr/bin/env node
/**
 * Send double-opt-in re-permission email to all unconfirmed subscribers.
 * Usage: node scripts/send-zoho-repermission.mjs [--dry-run] [--limit N]
 */
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createResendClient, sendNewsletterEmail } from '../src/integrations/resend.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ override: true });

const PUBLIC_SITE = 'https://fintechlaw.ai';

function tokenSecret() {
  return (
    process.env.NEWSLETTER_TOKEN_SECRET ||
    process.env.RESEND_WEBHOOK_SECRET ||
    ''
  );
}

function generateConfirmToken(email, subscriberId, secret) {
  const timestamp = Date.now();
  const data = `confirm:${email}:${subscriberId}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  const signature = hmac.digest('hex');
  return Buffer.from(`${data}:${signature}`).toString('base64url');
}

function resolveAgentBaseUrl() {
  const explicit = (process.env.APP_BASE_URL || process.env.CONTENT_AGENT_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const railway = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railway) return `https://${railway.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
  throw new Error('APP_BASE_URL or CONTENT_AGENT_BASE_URL required for confirm links');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : null;

  const url = process.env.SUPABASE_FLEET_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_FLEET_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL || 'FinTech Law <newsletter@fintechlaw.ai>';
  const secret = tokenSecret();

  if (!url || !key) {
    console.error('SUPABASE_FLEET_URL and SUPABASE_FLEET_SERVICE_KEY required');
    process.exit(1);
  }
  if (!dryRun && (!resendKey || !secret)) {
    console.error('RESEND_API_KEY and NEWSLETTER_TOKEN_SECRET (or RESEND_WEBHOOK_SECRET) required');
    process.exit(1);
  }

  const agentBase = resolveAgentBaseUrl();
  const supabase = createClient(url, key);
  const resend = dryRun ? null : createResendClient(resendKey);

  let query = supabase.from('subscribers').select('id, email').eq('status', 'unconfirmed');
  if (limit) query = query.limit(limit);
  const { data: subs, error } = await query;
  if (error) throw new Error(error.message);

  let sent = 0;
  for (const sub of subs ?? []) {
    const confirmToken = generateConfirmToken(sub.email, sub.id, secret);
    const confirmUrl = `${agentBase}/api/subscribe/confirm?token=${encodeURIComponent(confirmToken)}`;

    if (dryRun) {
      console.log(`DRY RUN would email ${sub.email} → ${confirmUrl}`);
      sent++;
      continue;
    }

    await sendNewsletterEmail(resend, {
      from,
      to: [sub.email],
      subject: 'Please confirm your FinTech Law newsletter subscription',
      html: `<p>We are re-permissioning our newsletter list under CAN-SPAM. Please confirm you want to continue receiving FinTech Law newsletters:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>This is informational attorney advertising, not legal advice.</p>`,
      text: `Confirm your subscription: ${confirmUrl}`,
      headers: {
        'List-Unsubscribe': `<${PUBLIC_SITE}/unsubscribe>`,
      },
    });

    await supabase.from('subscription_events').insert({
      subscriber_id: sub.id,
      event_type: 'opt_in_sent',
      consent_text: 'Zoho re-permission double opt-in',
      source: 'send-zoho-repermission.mjs',
    });
    sent++;
  }

  console.log(JSON.stringify({ sent, total: subs?.length ?? 0, agentBase }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
