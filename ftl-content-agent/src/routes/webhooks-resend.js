import express from 'express';
import crypto from 'crypto';
import { fail, start, success } from '../utils/logger.js';

/**
 * Resend webhook → issue_metrics + subscriber suppression on bounce/complaint.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} config
 */
export function createResendWebhookRouter(supabase, config) {
  const router = express.Router();

  router.post(
    '/webhooks/resend',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      start('POST /api/webhooks/resend');
      try {
        const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body ?? '');
        if (config.RESEND_WEBHOOK_SECRET) {
          if (!verifyResendSignature(req, rawBody, config.RESEND_WEBHOOK_SECRET)) {
            return res.status(401).json({ ok: false, error: 'invalid signature' });
          }
        }

        const event = JSON.parse(rawBody || '{}');
        const type = event?.type ?? event?.event;
        const emailId = event?.data?.email_id ?? event?.data?.id;
        const broadcastId = event?.data?.broadcast_id;
        const recipientEmail = String(
          event?.data?.to?.[0] ?? event?.data?.email ?? event?.data?.recipient ?? ''
        )
          .trim()
          .toLowerCase();

        const metricKind = mapResendEvent(type);
        if (!metricKind) {
          return res.json({ ok: true, ignored: true });
        }

        let issueId = null;
        if (broadcastId) {
          const { data } = await supabase
            .from('newsletter_issues')
            .select('id')
            .eq('resend_broadcast_id', broadcastId)
            .maybeSingle();
          issueId = data?.id ?? null;
        }

        const idemKey = `resend-${type}-${emailId ?? broadcastId ?? recipientEmail ?? Date.now()}`;
        await supabase.from('issue_metrics').upsert(
          {
            newsletter_issue_id: issueId,
            platform: 'resend',
            metric_kind: metricKind,
            value: 1,
            metadata: event,
            idem_key: idemKey,
          },
          { onConflict: 'idem_key' }
        );

        if ((metricKind === 'bounce' || metricKind === 'complaint') && recipientEmail) {
          await suppressSubscriber(supabase, recipientEmail, metricKind);
        }

        success('POST /api/webhooks/resend', { type, metricKind });
        res.json({ ok: true });
      } catch (error) {
        fail('POST /api/webhooks/resend', error);
        res.status(500).json({ ok: false, error: error.message });
      }
    }
  );

  return router;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} supabase @param {string} email @param {string} reason */
async function suppressSubscriber(supabase, email, reason) {
  const { data: sub } = await supabase
    .from('subscribers')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (!sub?.id) return;

  const now = new Date().toISOString();
  await supabase
    .from('subscribers')
    .update({ status: 'suppressed', updated_at: now })
    .eq('id', sub.id);
  await supabase.from('subscription_events').insert({
    subscriber_id: sub.id,
    event_type: reason === 'complaint' ? 'complained' : 'bounced',
    source: 'webhooks/resend',
    metadata: { reason },
  });
}

/** @param {import('express').Request} req @param {string} rawBody @param {string} secret */
function verifyResendSignature(req, rawBody, secret) {
  const svixId = req.headers['svix-id'];
  const svixTimestamp = req.headers['svix-timestamp'];
  const svixSignature = req.headers['svix-signature'];
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedContent).digest('base64');

  for (const part of String(svixSignature).split(' ')) {
    const [, sig] = part.split(',');
    if (sig === expected) return true;
  }
  return false;
}

/** @param {string} type */
function mapResendEvent(type) {
  const map = {
    'email.delivered': 'delivered',
    'email.opened': 'open',
    'email.clicked': 'click',
    'email.bounced': 'bounce',
    'email.complained': 'complaint',
    'email.unsubscribed': 'unsubscribe',
  };
  return map[type] ?? null;
}
