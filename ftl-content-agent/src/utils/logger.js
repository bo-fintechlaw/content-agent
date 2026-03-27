/**
 * Proof of Life logging — use start(), success(), and fail() on pipeline and integration code.
 */

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
