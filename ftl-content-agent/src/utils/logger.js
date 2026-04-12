/**
 * Proof of Life logging — use start(), success(), and fail() on pipeline and integration code.
 *
 * Structured logger for TypeScript utilities (Notion tools, caches): debug/info/warn/error.
 */

export const logger = {
  /** @param {Record<string, unknown>} [context] */
  debug(message, context = {}) {
    console.debug(message, context);
  },
  /** @param {Record<string, unknown>} [context] */
  info(message, context = {}) {
    console.log(message, context);
  },
  /** @param {Record<string, unknown>} [context] */
  warn(message, context = {}) {
    console.warn(message, context);
  },
  /** @param {Record<string, unknown>} [context] */
  error(message, context = {}) {
    console.error(message, context);
  },
};

export function start(fnName, meta = {}) {
  console.log(`🔍 START: ${fnName}`, {
    ...meta,
    timestamp: new Date().toISOString(),
  });
}

export function success(fnName, meta = {}) {
  console.log(`✅ SUCCESS: ${fnName}`, {
    ...meta,
    timestamp: new Date().toISOString(),
  });
}

export function fail(fnName, error, meta = {}) {
  console.error(`❌ FAILED: ${fnName}`, {
    error: error?.message ?? String(error),
    stack: error?.stack,
    ...meta,
    timestamp: new Date().toISOString(),
  });
}
