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
 * @param {{ audienceId: string, email: string, firstName?: string }} params
 */
export async function addContactToAudience(client, params) {
  start('addContactToAudience', { audienceId: params.audienceId, email: params.email });
  const result = await breaker.execute(
    () =>
      client.contacts.create({
        audienceId: params.audienceId,
        email: params.email,
        firstName: params.firstName,
        unsubscribed: false,
      }),
    { data: null, error: 'resend_contact_unavailable' }
  );
  if (result?.error) {
    fail('addContactToAudience', new Error(String(result.error)));
    throw new Error(String(result.error));
  }
  success('addContactToAudience', { id: result?.data?.id });
  return result?.data;
}

/**
 * @param {import('resend').Resend} client
 * @param {{ audienceId: string, email: string }} params
 */
export async function removeContactFromAudience(client, params) {
  start('removeContactFromAudience', { audienceId: params.audienceId, email: params.email });
  const result = await breaker.execute(
    () =>
      client.contacts.remove({
        audienceId: params.audienceId,
        email: params.email,
      }),
    { data: null, error: 'resend_contact_remove_unavailable' }
  );
  if (result?.error) {
    fail('removeContactFromAudience', new Error(String(result.error)));
    throw new Error(String(result.error));
  }
  success('removeContactFromAudience', { email: params.email });
  return result?.data;
}

/**
 * Create and send a broadcast to a Resend audience.
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
  const createResult = await breaker.execute(
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
  if (createResult?.error) {
    fail('sendNewsletterBroadcast:create', new Error(String(createResult.error)));
    throw new Error(String(createResult.error));
  }

  const broadcastId = createResult?.data?.id;
  if (!broadcastId) {
    throw new Error('Resend broadcast created but no id returned');
  }

  const sendResult = await breaker.execute(
    () => client.broadcasts.send(broadcastId),
    { data: null, error: 'resend_broadcast_send_unavailable' }
  );
  if (sendResult?.error) {
    fail('sendNewsletterBroadcast:send', new Error(String(sendResult.error)));
    throw new Error(String(sendResult.error));
  }

  success('sendNewsletterBroadcast', { id: broadcastId });
  return { id: broadcastId };
}
