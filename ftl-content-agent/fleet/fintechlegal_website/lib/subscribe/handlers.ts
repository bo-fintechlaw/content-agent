import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import type { SubscribeConfig } from './config.js';
import { CONSENT_TEXT } from './constants.js';
import { buildSubscribeConfirmEmail } from './confirm-email.js';
import { audienceForSegment, normalizeSegments } from './segments.js';
import { generateToken, verifyToken } from './tokens.js';

export function createFleetSupabase(config: SubscribeConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SubscribeBody = {
  email?: string;
  segments?: unknown;
  segment?: unknown;
  source?: string;
  consent_text?: string;
};

export async function handleSubscribePost(config: SubscribeConfig, body: SubscribeBody) {
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  const segments = normalizeSegments(body.segments ?? body.segment);
  const source = String(body.source ?? 'website_subscribe').trim() || 'website_subscribe';
  const consentText = String(body.consent_text ?? CONSENT_TEXT).trim() || CONSENT_TEXT;

  if (!email || !email.includes('@')) {
    return { status: 400, body: { ok: false, error: 'valid email required' } };
  }

  const supabase = createFleetSupabase(config);

  const { data: existing } = await supabase
    .from('subscribers')
    .select('id, status, segments')
    .eq('email', email)
    .maybeSingle();

  let subscriberId = existing?.id as string | undefined;

  if (!subscriberId) {
    const { data, error } = await supabase
      .from('subscribers')
      .insert({
        email,
        status: 'unconfirmed',
        segments,
        source,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    subscriberId = data.id;
  } else if (existing?.status !== 'suppressed') {
    const { error } = await supabase
      .from('subscribers')
      .update({ segments, source, updated_at: new Date().toISOString() })
      .eq('id', subscriberId);
    if (error) throw new Error(error.message);
  }

  await supabase.from('subscription_events').insert({
    subscriber_id: subscriberId,
    event_type: 'opt_in_sent',
    consent_text: consentText,
    source: 'api/subscribe',
    metadata: { segments, page_source: source },
  });

  if (config.resendApiKey) {
    const resend = new Resend(config.resendApiKey);
    const confirmToken = generateToken('confirm', email, subscriberId, config.tokenSecret);
    const confirmUrl = `${config.siteUrl}/api/subscribe/confirm?token=${encodeURIComponent(confirmToken)}`;
    const { subject, html, text } = buildSubscribeConfirmEmail({
      confirmUrl,
      mode: 'initial',
      segments,
      consentText,
      logoUrl: config.fintechlawLogoUrl,
    });
    const sendResult = await resend.emails.send({
      from: config.resendFrom,
      to: [email],
      subject,
      html,
      text,
    });
    if (sendResult.error) throw new Error(String(sendResult.error.message ?? sendResult.error));
  }

  return { status: 200, body: { ok: true, status: 'unconfirmed', message: 'confirmation_sent' } };
}

export async function handleSubscribeConfirmGet(config: SubscribeConfig, token: string) {
  if (!token) {
    return { status: 400, redirect: `${config.siteUrl}/newsletter/confirmed?error=missing_token` };
  }

  const tokenData = verifyToken('confirm', token, config.tokenSecret);
  if (!tokenData) {
    return { status: 400, redirect: `${config.siteUrl}/newsletter/confirmed?error=invalid_token` };
  }

  const { email, subscriberId } = tokenData;
  const supabase = createFleetSupabase(config);

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

    if (config.resendApiKey) {
      const resend = new Resend(config.resendApiKey);
      for (const segment of (sub.segments ?? []) as string[]) {
        const audienceId = audienceForSegment(segment, config);
        if (!audienceId) continue;
        try {
          const contactResult = await resend.contacts.create({
            audienceId,
            email,
            unsubscribed: false,
          });
          if (contactResult.data?.id) {
            await supabase
              .from('subscribers')
              .update({ resend_contact_id: contactResult.data.id, updated_at: now })
              .eq('id', sub.id);
          }
        } catch {
          // Non-fatal: subscriber is confirmed in Supabase even if Resend sync fails
        }
      }
    }
  }

  return { status: 302, redirect: `${config.siteUrl}/newsletter/confirmed` };
}

export async function handleUnsubscribeGet(config: SubscribeConfig, token: string) {
  if (!token) {
    return { status: 400, redirect: `${config.siteUrl}/unsubscribe?error=missing_token` };
  }

  const tokenData = verifyToken('unsubscribe', token, config.tokenSecret);
  if (!tokenData) {
    return { status: 400, redirect: `${config.siteUrl}/unsubscribe?error=invalid_token` };
  }

  const { email, subscriberId } = tokenData;
  const now = new Date().toISOString();
  const supabase = createFleetSupabase(config);

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

    if (config.resendApiKey) {
      const resend = new Resend(config.resendApiKey);
      for (const segment of (sub.segments ?? []) as string[]) {
        const audienceId = audienceForSegment(segment, config);
        if (!audienceId) continue;
        try {
          await resend.contacts.remove({ audienceId, email });
        } catch {
          // Non-fatal
        }
      }
    }
  }

  return { status: 302, redirect: `${config.siteUrl}/unsubscribe?done=1` };
}
