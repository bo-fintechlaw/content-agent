import express from 'express';
import { fail, start, success } from '../utils/logger.js';

/**
 * Double opt-in subscribe endpoints.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} config
 */
export function createSubscribeRouter(supabase, config) {
  const router = express.Router();

  router.post('/newsletter/subscribe', express.json(), async (req, res) => {
    start('POST /api/newsletter/subscribe');
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const segments = normalizeSegments(req.body?.segments);
      if (!email || !email.includes('@')) {
        return res.status(400).json({ ok: false, error: 'valid email required' });
      }

      const { data: existing } = await supabase
        .from('subscribers')
        .select('id, status')
        .eq('email', email)
        .maybeSingle();

      let subscriberId = existing?.id;
      if (!subscriberId) {
        const { data, error } = await supabase
          .from('subscribers')
          .insert({
            email,
            status: 'unconfirmed',
            segments,
            source: 'website_subscribe',
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        subscriberId = data.id;
      }

      await supabase.from('subscription_events').insert({
        subscriber_id: subscriberId,
        event_type: 'opt_in_sent',
        consent_text: req.body?.consent_text ?? 'Double opt-in requested via fintechlaw.ai',
        source: 'api/newsletter/subscribe',
        metadata: { segments },
      });

      if (config.RESEND_API_KEY) {
        const { createResendClient, sendNewsletterEmail } = await import(
          '../integrations/resend.js'
        );
        const resend = createResendClient(config.RESEND_API_KEY);
        const confirmUrl = `https://fintechlaw.ai/subscribe/confirm?email=${encodeURIComponent(email)}`;
        await sendNewsletterEmail(resend, {
          from: config.RESEND_FROM_EMAIL,
          to: [email],
          subject: 'Confirm your FinTech Law newsletter subscription',
          html: `<p>Please confirm: <a href="${confirmUrl}">${confirmUrl}</a></p>`,
          text: `Confirm your subscription: ${confirmUrl}`,
        });
      }

      success('POST /api/newsletter/subscribe', { subscriberId });
      res.json({ ok: true, status: 'unconfirmed', message: 'confirmation_sent' });
    } catch (error) {
      fail('POST /api/newsletter/subscribe', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/newsletter/subscribe/confirm', async (req, res) => {
    const email = String(req.query.email ?? '').trim().toLowerCase();
    if (!email) return res.status(400).send('Missing email');

    const { data: sub } = await supabase
      .from('subscribers')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (sub?.id) {
      const now = new Date().toISOString();
      await supabase
        .from('subscribers')
        .update({ status: 'confirmed', confirmed_at: now, updated_at: now })
        .eq('id', sub.id);
      await supabase.from('subscription_events').insert({
        subscriber_id: sub.id,
        event_type: 'confirmed',
        source: 'api/newsletter/subscribe/confirm',
      });
    }

    res.redirect('https://fintechlaw.ai/subscribe?confirmed=1');
  });

  return router;
}

/** @param {unknown} raw */
function normalizeSegments(raw) {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((s) => String(s));
  }
  return ['financial_services', 'tech_ai_legal'];
}
