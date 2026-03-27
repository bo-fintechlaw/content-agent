import { createClient } from '@supabase/supabase-js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('supabase');

/**
 * Creates a Supabase client using validated URL and service key.
 * @param {string} url
 * @param {string} serviceKey
 */
export function createSupabaseClient(url, serviceKey) {
  start('createSupabaseClient', { urlHost: safeHost(url) });

  try {
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    success('createSupabaseClient');
    return client;
  } catch (error) {
    fail('createSupabaseClient', error);
    throw error;
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid-url)';
  }
}

/**
 * Lightweight DB connectivity check (uses circuit breaker).
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 */
export async function checkSupabaseConnection(client) {
  start('checkSupabaseConnection');

  try {
    const result = await breaker.execute(async () => {
      const { error } = await client.from('content_config').select('key').limit(1);
      if (error) throw new Error(error.message);
      return { connected: true };
    }, { connected: false, error: 'unavailable' });

    if (result.connected) {
      success('checkSupabaseConnection');
    } else {
      fail(
        'checkSupabaseConnection',
        new Error(String(result.error ?? 'circuit or query failed'))
      );
    }

    return result;
  } catch (error) {
    fail('checkSupabaseConnection', error);
    return { connected: false, error: error.message };
  }
}
