import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { TtlCache as TtlCacheType } from '../../utils/cache.js';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { TtlCache } = await import('../../utils/cache.js');
const { logger } = await import('../../utils/logger.js');

describe('TtlCache', () => {
  let cache: TtlCacheType<string>;

  beforeEach(() => {
    cache = new TtlCache<string>('test', { ttlMs: 1000 });
    jest.clearAllMocks();
  });

  describe('get/set', () => {
    it('should return undefined for missing keys', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should return cached values within TTL', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('should overwrite existing entries', () => {
      cache.set('key', 'first');
      cache.set('key', 'second');
      expect(cache.get('key')).toBe('second');
    });

    it('should store different types', () => {
      const objCache = new TtlCache<{ id: number }>('obj', { ttlMs: 1000 });
      objCache.set('a', { id: 1 });
      expect(objCache.get('a')).toEqual({ id: 1 });
    });
  });

  describe('TTL expiration', () => {
    it('should return undefined after TTL expires', () => {
      const shortCache = new TtlCache<string>('short', { ttlMs: 1 });
      shortCache.set('key', 'value');
      const start = Date.now();
      while (Date.now() - start < 5) {}
      expect(shortCache.get('key')).toBeUndefined();
    });

    it('should lazily remove expired entries on read', () => {
      const shortCache = new TtlCache<string>('short', { ttlMs: 1 });
      shortCache.set('key', 'value');
      const start = Date.now();
      while (Date.now() - start < 5) {}
      expect(shortCache.get('key')).toBeUndefined();
      expect(shortCache.get('key')).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('should remove a cached entry', () => {
      cache.set('key', 'value');
      expect(cache.invalidate('key')).toBe(true);
      expect(cache.get('key')).toBeUndefined();
    });

    it('should return false for missing keys', () => {
      expect(cache.invalidate('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.clear();
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBeUndefined();
    });
  });

  describe('debug logging', () => {
    it('should log cache miss', () => {
      cache.get('missing');
      expect(logger.debug).toHaveBeenCalledWith('Cache miss', {
        cache: 'test',
        key: 'missing',
      });
    });

    it('should log cache hit', () => {
      cache.set('key', 'value');
      cache.get('key');
      expect(logger.debug).toHaveBeenCalledWith('Cache hit', {
        cache: 'test',
        key: 'key',
      });
    });

    it('should log cache expired', () => {
      const shortCache = new TtlCache<string>('expiry-test', { ttlMs: 1 });
      shortCache.set('key', 'value');
      const start = Date.now();
      while (Date.now() - start < 5) {}
      shortCache.get('key');
      expect(logger.debug).toHaveBeenCalledWith('Cache expired', {
        cache: 'expiry-test',
        key: 'key',
      });
    });
  });
});
