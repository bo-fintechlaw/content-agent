import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
  EXTENDED_CACHE_TTL_BETA,
  buildAnthropicSystemBlocks,
  promptCacheRequestHeaders,
  resolvePromptCache,
} from '../../utils/promptCache.js';

describe('resolvePromptCache', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.ANTHROPIC_PROMPT_CACHE_ENABLED = '1';
    process.env.ANTHROPIC_PROMPT_CACHE_TTL = '5m';
  });

  afterEach(() => {
    process.env = env;
  });

  it('uses env defaults when metadata is absent', () => {
    expect(resolvePromptCache()).toEqual({ enabled: true, ttl: '5m' });
  });

  it('honors metadata.promptCache.enabled=false', () => {
    expect(resolvePromptCache({ promptCache: { enabled: false } })).toEqual({
      enabled: false,
      ttl: '5m',
    });
  });

  it('honors metadata.promptCache.ttl=1h', () => {
    expect(resolvePromptCache({ promptCache: { ttl: '1h' } })).toEqual({
      enabled: true,
      ttl: '1h',
    });
  });
});

describe('buildAnthropicSystemBlocks', () => {
  it('adds cache_control when enabled', () => {
    const blocks = buildAnthropicSystemBlocks('stable prefix', { enabled: true, ttl: '5m' });
    expect(blocks?.[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('uses 1h ttl when configured', () => {
    const blocks = buildAnthropicSystemBlocks('stable prefix', { enabled: true, ttl: '1h' });
    expect(blocks?.[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});

describe('promptCacheRequestHeaders', () => {
  it('adds extended-cache beta header for 1h ttl', () => {
    expect(promptCacheRequestHeaders({ enabled: true, ttl: '1h' })).toEqual({
      'anthropic-beta': EXTENDED_CACHE_TTL_BETA,
    });
  });
});
