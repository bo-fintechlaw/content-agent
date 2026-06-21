import express from 'express';
import crypto from 'crypto';
import { fail, start, success } from '../utils/logger.js';
import {
  addContactToAudience,
  createResendClient,
  removeContactFromAudience,
  sendNewsletterEmail,
} from '../integrations/resend.js';

const VALID_SEGMENTS = new Set(['financial_services', 'tech_ai_legal']);
const TOKEN_EXPIRY_HOURS = 72;

/**
 * Double opt-in subscribe endpoints (fleet Supabase + Resend audiences).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} config
 */
export function createSubscribeRouter(supabase, config) {
  const router = express.Router();
  const tokenSecret =
    config.NEWSLETTER_TOKEN_SECRET ||
    config.RESEND_WEBHOOK_SECRET ||
    'default-secret-change-in-production';

  /**
   * @param {'confirm' | 'unsubscribe'} purpose
   * @param {string} email
   * @param {string} subscriberId
   */
  function generateToken(purpose, email, subscriberId) {
    const timestamp = Date.now();
    const data = `${purpose}:${email}:${subscriberId}:${timestamp}`;
    const hmac = crypto.createHmac('sha256', tokenSecret);
    hmac.update(data);
    const signature = hmac.digest('hex');
    return Buffer.from(`${data}:${signature}`).toString('base64url');
  }

  /**
   * @param {'confirm' | 'unsubscribe'} purpose
   * @param {string} token
   */
  function verifyToken(purpose, token) {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length !== 5) return null;

      const [tokenPurpose, email, subscriberId, timestamp, signature] = parts;
      if (tokenPurpose !== purpose) return null;

      const data = `${tokenPurpose}:${email}:${subscriberId}:${timestamp}`;
      const hmac = crypto.createHmac('sha256', tokenSecret);
      hmac.update(data);
      const expectedSignature = hmac.digest('hex');
      if (signature !== expectedSignature) return null;

      const tokenAge = Date.now() - parseInt(timestamp, 10);
      const expiryMs = TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;
      if (tokenAge > expiryMs) return null;

      return { email, subscriberId, timestamp: parseInt(timestamp, 10) };
    } catch {
      return null;
    }
  }

  router.post('/subscribe', express.json(), async (req, res) => {
    start('POST /api/subscribe');
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const segments = normalizeSegments(req.body?.segments ?? req.body?.segment);
      if (!email || !email.includes('@')) {
        return res.status(400).json({ ok: false, error: 'valid email required' });
      }

      const { data: existing } = await supabase
        .from('subscribers')
        .select('id, status, segments')
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
      } else if (existing.status !== 'suppressed') {
        await supabase
          .from('subscribers')
          .update({ segments, updated_at: new Date().toISOString() })
          .eq('id', subscriberId);
      }

      await supabase.from('subscription_events').insert({
        subscriber_id: subscriberId,
        event_type: 'opt_in_sent',
        consent_text: req.body?.consent_text ?? 'Double opt-in requested via fintechlaw.ai',
        source: 'api/subscribe',
        metadata: { segments },
      });

      if (config.RESEND_API_KEY) {
        const resend = createResendClient(config.RESEND_API_KEY);
        const confirmToken = generateToken('confirm', email, subscriberId);
        const confirmUrl = `https://fintechlaw.ai/newsletter/confirmed?token=${encodeURIComponent(confirmToken)}`;
        await sendNewsletterEmail(resend, {
          from: config.RESEND_FROM,
          to: [email],
          subject: 'Confirm your FinTech Law newsletter subscription',
          html: `<p>Please confirm your subscription:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p>`,
          text: `Confirm your subscription: ${confirmUrl}`,
        });
      }

      success('POST /api/subscribe', { subscriberId });
      res.json({ ok: true, status: 'unconfirmed', message: 'confirmation_sent' });
    } catch (error) {
      fail('POST /api/subscribe', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/subscribe/confirm', async (req, res) => {
    start('GET /api/subscribe/confirm');
    const token = String(req.query.token ?? '').trim();
    if (!token) return res.status(400).send('Missing or invalid confirmation token');

    const tokenData = verifyToken('confirm', token);
    if (!tokenData) return res.status(400).send('Invalid or expired confirmation token');

    const { email, subscriberId } = tokenData;

    const { data: sub } = await supabase
      .from('subscribers')
      .select('id, segments, status')
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
        source: 'api/subscribe/confirm',
      });

      if (config.RESEND_API_KEY) {
        const resend = createResendClient(config.RESEND_API_KEY);
        for (const segment of sub.segments ?? []) {
          const audienceId = audienceForSegment(config, segment);
          if (!audienceId) continue;
          try {
            const contact = await addContactToAudience(resend, {
              audienceId,
              email,
            });
            if (contact?.id) {
              await supabase
                .from('subscribers')
                .update({ resend_contact_id: contact.id, updated_at: now })
                .eq('id', sub.id);
            }
          } catch (audienceErr) {
            fail('GET /api/subscribe/confirm:audience', audienceErr, { segment, email });
          }
        }
      }
    }

    success('GET /api/subscribe/confirm', { subscriberId });
    res.redirect('https://fintechlaw.ai/newsletter/confirmed');
  });

  router.get('/unsubscribe', async (req, res) => {
    start('GET /api/unsubscribe');
    const token = String(req.query.token ?? '').trim();
    if (!token) return res.status(400).send('Missing or invalid unsubscribe token');

    const tokenData = verifyToken('unsubscribe', token);
    if (!tokenData) return res.status(400).send('Invalid or expired unsubscribe token');

    const { email, subscriberId } = tokenData;
    const now = new Date().toISOString();

    const { data: sub } = await supabase
      .from('subscribers')
      .select('id, segments')
      .eq('id', subscriberId)
      .eq('email', email)
      .maybeSingle();

    if (sub?.id) {
      await supabase
        .from('subscribers')
        .update({ status: 'unsubscribed', updated_at: now })
        .eq('id', sub.id);
      await supabase.from('subscription_events').insert({
        subscriber_id: sub.id,
        event_type: 'unsubscribed',
        source: 'api/unsubscribe',
      });

      if (config.RESEND_API_KEY) {
        const resend = createResendClient(config.RESEND_API_KEY);
        for (const segment of sub.segments ?? []) {
          const audienceId = audienceForSegment(config, segment);
          if (!audienceId) continue;
          try {
            await removeContactFromAudience(resend, { audienceId, email });
          } catch (removeErr) {
            fail('GET /api/unsubscribe:audience', removeErr, { segment, email });
          }
        }
      }
    }

    success('GET /api/unsubscribe', { subscriberId });
    res.redirect('https://fintechlaw.ai/unsubscribe?done=1');
  });

  return router;
}

/** @param {Record<string, unknown>} config @param {string} segment */
function audienceForSegment(config, segment) {
  if (segment === 'financial_services') return config.RESEND_AUDIENCE_FINANCIAL_SERVICES;
  if (segment === 'tech_ai_legal') return config.RESEND_AUDIENCE_TECH_AI_LEGAL;
  return null;
}

/** @param {unknown} raw */
function normalizeSegments(raw) {
  if (typeof raw === 'string') {
    if (raw === 'both') return ['financial_services', 'tech_ai_legal'];
    if (VALID_SEGMENTS.has(raw)) return [raw];
  }
  if (Array.isArray(raw) && raw.length) {
    const segs = raw.map((s) => String(s)).filter((s) => VALID_SEGMENTS.has(s));
    if (segs.length) return [...new Set(segs)];
  }
  return ['financial_services', 'tech_ai_legal'];
}
