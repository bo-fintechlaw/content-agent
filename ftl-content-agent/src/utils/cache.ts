import { logger } from './logger.js';

export interface TtlCacheOptions {
  ttlMs: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly name: string;

  constructor(name: string, options: TtlCacheOptions) {
    this.name = name;
    this.ttlMs = options.ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      logger.debug('Cache miss', { cache: this.name, key });
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      logger.debug('Cache expired', { cache: this.name, key });
      return undefined;
    }
    logger.debug('Cache hit', { cache: this.name, key });
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
