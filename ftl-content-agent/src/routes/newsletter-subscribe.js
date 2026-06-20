import express from 'express';
import crypto from 'crypto';
import { fail, start, success } from '../utils/logger.js';

/**
 * Double opt-in subscribe endpoints.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} config
 */
export function createSubscribeRouter(supabase, config) {
  const router = express.Router();
  const TOKEN_EXPIRY_HOURS = 24;
  const TOKEN_SECRET = config.NEWSLETTER_TOKEN_SECRET || 'default-secret-change-in-production';

  /**
   * Generate a signed confirmation token
   * @param {string} email
   * @param {string} subscriberId
   * @returns {string}
   */
  function generateConfirmationToken(email, subscriberId) {
    const timestamp = Date.now();
    const data = `${email}:${subscriberId}:${timestamp}`;
    const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
    hmac.update(data);
    const signature = hmac.digest('hex');
    return Buffer.from(`${data}:${signature}`).toString('base64');
  }

  /**
   * Verify and decode a confirmation token
   * @param {string} token
   * @returns {{email: string, subscriberId: string, timestamp: number} | null}
   */
  function verifyConfirmationToken(token) {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length !== 4) return null;

      const [email, subscriberId, timestamp, signature] = parts;
      const data = `${email}:${subscriberId}:${timestamp}`;
      const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
      hmac.update(data);
      const expectedSignature = hmac.digest('hex');

      if (signature !== expectedSignature) return null;

      const tokenAge = Date.now() - parseInt(timestamp, 10);
      const expiryMs = TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;
      if (tokenAge > expiryMs) return null;

      return { email, subscriberId, timestamp: parseInt(timestamp, 10) };
    } catch (error) {
      return null;
    }
  }

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
        const confirmToken = generateConfirmationToken(email, subscriberId);
        const confirmUrl = `https://fintechlaw.ai/subscribe/confirm?token=${encodeURIComponent(confirmToken)}`;
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
    const token = String(req.query.token ?? '').trim();
    if (!token) return res.status(400).send('Missing or invalid confirmation token');

    const tokenData = verifyConfirmationToken(token);
    if (!tokenData) return res.status(400).send('Invalid or expired confirmation token');

    const { email, subscriberId } = tokenData;

    const { data: sub } = await supabase
      .from('subscribers')
      .select('id')
      .eq('id', subscriberId)
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
