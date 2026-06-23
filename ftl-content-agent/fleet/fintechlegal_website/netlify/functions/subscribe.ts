import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { loadSubscribeConfig } from '../../lib/subscribe/config.js';
import { handleSubscribePost } from '../../lib/subscribe/handlers.js';

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Method not allowed' }),
    };
  }

  try {
    const config = loadSubscribeConfig();
    const body = event.body ? JSON.parse(event.body) : {};
    const result = await handleSubscribePost(config, body);
    return {
      statusCode: result.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify(result.body),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'subscribe_failed';
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: message }),
    };
  }
};
