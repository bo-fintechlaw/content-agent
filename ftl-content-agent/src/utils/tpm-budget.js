/**
 * Sliding-window input-token-per-minute tracker, keyed by Anthropic model.
 *
 * Anthropic rate limits are enforced per-model. We mirror that here: each
 * model gets its own 60s window. `waitForCapacity` blocks until the running
 * total of input tokens in the last 60s plus `estimatedTokens` would fit
 * under the configured cap. `record` is called with the actual `usage.input_tokens`
 * reported by the API response so the running total self-corrects from
 * estimation drift.
 *
 * The cap should be set below the hard Anthropic ceiling so retries and
 * other concurrent callers have headroom — e.g. 25k for a 30k tier-1 quota.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WINDOW_MS = 60_000;
const POLL_MS = 1_000;

class TpmTracker {
  /** @param {{ defaultLimit?: number, perModelLimits?: Record<string, number> }} [opts] */
  constructor(opts = {}) {
    /** @type {Map<string, Array<{ ts: number, tokens: number }>>} */
    this.usage = new Map();
    this.defaultLimit = opts.defaultLimit ?? 25_000;
    this.perModelLimits = opts.perModelLimits ?? {};
  }

  setLimit(model, limit) {
    if (!model || !Number.isFinite(limit)) return;
    this.perModelLimits[model] = Math.max(1, Math.floor(limit));
  }

  setDefaultLimit(limit) {
    if (Number.isFinite(limit)) this.defaultLimit = Math.max(1, Math.floor(limit));
  }

  limitFor(model) {
    return this.perModelLimits[model] ?? this.defaultLimit;
  }

  _prune(model, now) {
    const arr = this.usage.get(model);
    if (!arr || !arr.length) return [];
    const cutoff = now - WINDOW_MS;
    let i = 0;
    while (i < arr.length && arr[i].ts < cutoff) i++;
    if (i > 0) arr.splice(0, i);
    return arr;
  }

  usageInWindow(model, now = Date.now()) {
    const arr = this._prune(model, now);
    return arr.reduce((sum, e) => sum + e.tokens, 0);
  }

  /**
   * Block until adding `estimatedTokens` would not exceed the per-minute cap.
   * Returns the number of milliseconds it waited.
   */
  async waitForCapacity(model, estimatedTokens) {
    const limit = this.limitFor(model);
    const safeEstimate = Math.max(0, Math.floor(estimatedTokens));
    const start = Date.now();

    while (true) {
      const now = Date.now();
      const arr = this._prune(model, now);
      const used = arr.reduce((s, e) => s + e.tokens, 0);
      if (used + safeEstimate <= limit) return now - start;

      const oldest = arr[0];
      const waitUntilFreed = oldest ? WINDOW_MS - (now - oldest.ts) : POLL_MS;
      const sleepFor = Math.max(POLL_MS, Math.min(waitUntilFreed + 250, 5_000));
      console.warn(
        `⏳ tpm-budget: ${model} at ${used}/${limit} tok/min, ` +
          `need +${safeEstimate}, sleeping ${Math.round(sleepFor / 1000)}s`
      );
      await sleep(sleepFor);
    }
  }

  record(model, tokens) {
    const n = Number(tokens);
    if (!Number.isFinite(n) || n <= 0) return;
    const arr = this.usage.get(model) ?? [];
    arr.push({ ts: Date.now(), tokens: Math.floor(n) });
    this.usage.set(model, arr);
  }
}

/**
 * Rough char→token estimate. Anthropic doesn't publish a character→token
 * formula but ~4 chars/token is a widely-used heuristic for English prose.
 * Slightly conservative on the high side (3.5) so we under-promise capacity.
 */
export function estimateInputTokens({ system = '', user = '', toolOverheadTokens = 0 }) {
  const chars = (system?.length ?? 0) + (user?.length ?? 0);
  return Math.ceil(chars / 3.5) + Math.max(0, toolOverheadTokens);
}

/** Singleton — anthropic.js uses this. Limits get set in main() from env. */
export const tpmBudget = new TpmTracker({ defaultLimit: 25_000 });
