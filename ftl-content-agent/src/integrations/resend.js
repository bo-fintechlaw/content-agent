import { Resend } from 'resend';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('resend');

/**
 * @param {string} apiKey
 */
export function createResendClient(apiKey) {
  start('createResendClient');
  if (!apiKey?.trim()) throw new Error('Missing RESEND_API_KEY');
  const client = new Resend(apiKey.trim());
  success('createResendClient');
  return client;
}

/**
 * @param {import('resend').Resend} client
 * @param {{
 *   from: string,
 *   to: string[],
 *   subject: string,
 *   html: string,
 *   text?: string,
 *   headers?: Record<string, string>,
 * }} params
 */
export async function sendNewsletterEmail(client, params) {
  start('sendNewsletterEmail', { toCount: params.to?.length ?? 0 });
  const result = await breaker.execute(
    () =>
      client.emails.send({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        headers: params.headers,
      }),
    { data: null, error: 'resend_unavailable' }
  );
  if (result?.error) {
    fail('sendNewsletterEmail', new Error(String(result.error)));
    throw new Error(String(result.error));
  }
  success('sendNewsletterEmail', { id: result?.data?.id });
  return result?.data;
}

/**
 * @param {import('resend').Resend} client
 * @param {{
 *   audienceId: string,
 *   from: string,
 *   subject: string,
 *   html: string,
 *   text?: string,
 * }} params
 */
export async function sendNewsletterBroadcast(client, params) {
  start('sendNewsletterBroadcast', { audienceId: params.audienceId });
  const result = await breaker.execute(
    () =>
      client.broadcasts.create({
        audienceId: params.audienceId,
        from: params.from,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    { data: null, error: 'resend_broadcast_unavailable' }
  );
  if (result?.error) {
    fail('sendNewsletterBroadcast', new Error(String(result.error)));
    throw new Error(String(result.error));
  }
  success('sendNewsletterBroadcast', { id: result?.data?.id });
  return result?.data;
}
