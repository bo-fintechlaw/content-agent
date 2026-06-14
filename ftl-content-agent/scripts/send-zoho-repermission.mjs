#!/usr/bin/env node
/**
 * Send double-opt-in re-permission email to all unconfirmed subscribers.
 * Usage: node scripts/send-zoho-repermission.mjs
 */
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createResendClient, sendNewsletterEmail } from '../src/integrations/resend.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ override: true });

const PUBLIC_SITE = 'https://fintechlaw.ai';

async function main() {
  const url = process.env.SUPABASE_FLEET_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_FLEET_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'FinTech Law <newsletter@fintechlaw.ai>';

  if (!url || !key || !resendKey) {
    console.error('SUPABASE_FLEET_URL, SUPABASE_FLEET_SERVICE_KEY, RESEND_API_KEY required');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const resend = createResendClient(resendKey);

  const { data: subs, error } = await supabase
    .from('subscribers')
    .select('id, email')
    .eq('status', 'unconfirmed');
  if (error) throw new Error(error.message);

  let sent = 0;
  for (const sub of subs ?? []) {
    const confirmUrl = `${PUBLIC_SITE}/api/newsletter/subscribe/confirm?email=${encodeURIComponent(sub.email)}`;
    await sendNewsletterEmail(resend, {
      from,
      to: [sub.email],
      subject: 'Please confirm your FinTech Law newsletter subscription',
      html: `<p>We are re-permissioning our list. Please confirm you want to continue receiving FinTech Law newsletters: <a href="${confirmUrl}">${confirmUrl}</a></p><p>This is informational attorney advertising, not legal advice.</p>`,
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

  console.log(JSON.stringify({ sent, total: subs?.length ?? 0 }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
