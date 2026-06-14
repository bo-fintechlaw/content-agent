import { WebClient } from '@slack/web-api';
import { buildNewsletterIssueDraftCard } from './newsletterCard.js';

/**
 * @param {{
 *   token: string,
 *   channelId: string,
 *   payload: Parameters<typeof buildNewsletterIssueDraftCard>[0],
 * }} args
 */
export async function postNewsletterIssueDraftCard(args) {
  const client = new WebClient(args.token);
  const blocks = buildNewsletterIssueDraftCard(args.payload);
  return client.chat.postMessage({
    channel: args.channelId,
    text: `Newsletter draft ready for review: ${args.payload.title}`,
    blocks,
  });
}
