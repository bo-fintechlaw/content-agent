/**
 * Anthropic prompt caching helpers — mirror ftl-cto-agent/src/services/llmClient.ts.
 */

export const EXTENDED_CACHE_TTL_BETA = 'extended-cache-ttl-2025-04-11';

/**
 * @param {{ promptCache?: { enabled?: boolean; ttl?: '5m' | '1h' } }} [metadata]
 * @returns {{ enabled: boolean; ttl: '5m' | '1h' }}
 */
export function resolvePromptCache(metadata) {
  const meta = metadata?.promptCache;
  const enabled = (() => {
    if (process.env.ANTHROPIC_PROMPT_CACHE_ENABLED === '0') return false;
    if (process.env.ANTHROPIC_PROMPT_CACHE_ENABLED === '1') return true;
    return true;
  })();
  const ttl = (() => {
    const t = (process.env.ANTHROPIC_PROMPT_CACHE_TTL || '5m').toLowerCase();
    return t === '1h' ? '1h' : '5m';
  })();
  return {
    enabled: meta?.enabled ?? enabled,
    ttl: meta?.ttl ?? ttl,
  };
}

/**
 * @param {string} systemText
 * @param {{ enabled: boolean; ttl: '5m' | '1h' }} cache
 * @returns {Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl?: '1h' } }> | undefined}
 */
export function buildAnthropicSystemBlocks(systemText, cache) {
  if (!systemText) return undefined;
  const block = { type: 'text', text: systemText };
  if (cache.enabled) {
    block.cache_control =
      cache.ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
  }
  return [block];
}

/**
 * @param {{ enabled: boolean; ttl: '5m' | '1h' }} cache
 * @returns {Record<string, string> | undefined}
 */
export function promptCacheRequestHeaders(cache) {
  return cache.enabled && cache.ttl === '1h'
    ? { 'anthropic-beta': EXTENDED_CACHE_TTL_BETA }
    : undefined;
}

/**
 * @param {import('@anthropic-ai/sdk').default.Messages.Message} response
 * @param {{ enabled: boolean; ttl: '5m' | '1h' }} cache
 * @param {string} model
 * @param {import('../utils/logger.js').LoggerLike} [log]
 */
export function logPromptCacheUsage(response, cache, model, log) {
  const cacheRead = response.usage?.cache_read_input_tokens ?? 0;
  const payload = {
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: cacheRead,
    promptCacheEnabled: cache.enabled,
    promptCacheTtl: cache.ttl,
  };
  if (cacheRead > 0) {
    log?.info?.('llm.complete.cache_hit', payload);
  } else {
    log?.debug?.('llm.complete', payload);
  }
}
