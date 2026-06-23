import type { Handler, HandlerEvent } from '@netlify/functions';
import { loadSubscribeConfig } from '../../lib/subscribe/config.js';
import { handleUnsubscribeGet } from '../../lib/subscribe/handlers.js';

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const config = loadSubscribeConfig();
    const token = String(event.queryStringParameters?.token ?? '').trim();
    const result = await handleUnsubscribeGet(config, token);
    return {
      statusCode: result.status,
      headers: { Location: result.redirect },
      body: '',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unsubscribe_failed';
    return { statusCode: 500, body: message };
  }
};
