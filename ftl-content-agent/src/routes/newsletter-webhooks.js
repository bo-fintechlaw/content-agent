import express from 'express';
import { fail, start, success } from '../utils/logger.js';

/**
 * Resend webhook → issue_metrics
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export function createNewsletterWebhookRouter(supabase) {
  const router = express.Router();

  router.post('/resend/webhook', express.json(), async (req, res) => {
    start('POST /api/resend/webhook');
    try {
      const event = req.body;
      const type = event?.type ?? event?.event;
      const emailId = event?.data?.email_id ?? event?.data?.id;
      const broadcastId = event?.data?.broadcast_id;

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

      const idemKey = `resend-${type}-${emailId ?? broadcastId ?? Date.now()}`;
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

      success('POST /api/resend/webhook', { type, metricKind });
      res.json({ ok: true });
    } catch (error) {
      fail('POST /api/resend/webhook', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  return router;
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
