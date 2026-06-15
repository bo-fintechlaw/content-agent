import Anthropic from '@anthropic-ai/sdk';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { tpmBudget, estimateInputTokens } from '../utils/tpm-budget.js';
import { fail, start, success } from '../utils/logger.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Per-model circuit breakers. Anthropic rate limits are enforced per-model,
 * so a Sonnet stall shouldn't open the breaker on Haiku (and vice-versa).
 * Breakers are lazy-instantiated on first use of each model.
 */
const breakers = new Map();
function getBreaker(model) {
  const key = model || DEFAULT_MODEL;
  let b = breakers.get(key);
  if (!b) {
    b = new CircuitBreaker(`anthropic:${key}`);
    breakers.set(key, b);
  }
  return b;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));

/**
 * Opus 4.7+ rejects temperature, top_p, and top_k (400 if set).
 * @see https://platform.claude.com/docs/en/about-claude/model-deprecations
 * @param {string} model
 */
export function modelSupportsSamplingParams(model) {
  const m = String(model ?? '').toLowerCase();
  if (/claude-opus-4-(7|8|9)/.test(m)) return false;
  if (m.includes('opus-4-7') || m.includes('opus-4-8')) return false;
  return true;
}

/** @param {Record<string, unknown>} base */
function withOptionalTemperature(base, model, temperature) {
  if (!modelSupportsSamplingParams(model)) return base;
  if (temperature == null) return base;
  return { ...base, temperature };
}

/**
 * Retry the underlying messages.create call with exponential backoff + jitter
 * on retryable errors (429 rate limit, 5xx). Non-retryable errors (4xx other
 * than 429) propagate immediately.
 *
 * Three attempts total (initial + 2 retries) with delays roughly:
 *   attempt 1 fails → wait ~30s ± jitter
 *   attempt 2 fails → wait ~90s ± jitter
 *   attempt 3 fails → throw
 *
 * For 429 specifically, prefer the server's `retry-after` header when it
 * exceeds our scheduled backoff (capped at 240s so a stuck cron doesn't
 * block forever).
 */
const RETRY_BASE_MS = [30_000, 90_000];
const RETRY_CAP_MS = 240_000;

async function callWithBackoff(operation) {
  let lastErr;
  for (let attempt = 0; attempt < RETRY_BASE_MS.length + 1; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status ?? null;
      const retryable = status === 429 || (typeof status === 'number' && status >= 500);
      const isLast = attempt === RETRY_BASE_MS.length;
      if (!retryable || isLast) throw err;

      const baseWait = RETRY_BASE_MS[attempt];
      const retryAfterSec = Number(
        err?.headers?.['retry-after'] ?? err?.response?.headers?.['retry-after'] ?? 0
      );
      const headerWaitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.round(retryAfterSec * 1_000)
        : 0;
      const waitMs = Math.min(RETRY_CAP_MS, jitter(Math.max(baseWait, headerWaitMs)));
      console.warn(
        `⚠️ anthropic ${status} — retry ${attempt + 1}/${RETRY_BASE_MS.length} in ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

/**
 * @param {string} apiKey
 */
export function createAnthropicClient(apiKey) {
  start('createAnthropicClient');
  try {
    const client = new Anthropic({ apiKey });
    success('createAnthropicClient');
    return client;
  } catch (error) {
    fail('createAnthropicClient', error);
    throw error;
  }
}

/**
 * @param {Anthropic} client
 * @param {{ system: string, user: string, model?: string, maxTokens?: number, temperature?: number }} args
 */
export async function promptJson(client, args) {
  start('promptJson');
  const model = args.model || DEFAULT_MODEL;
  const estimate = estimateInputTokens({ system: args.system, user: args.user });
  await tpmBudget.waitForCapacity(model, estimate);

  const breaker = getBreaker(model);
  const result = await breaker.execute(
    async () =>
      callWithBackoff(async () => {
        const resp = await client.messages.create(
          withOptionalTemperature(
            {
              model,
              max_tokens: args.maxTokens ?? 1800,
              system: args.system,
              messages: [{ role: 'user', content: args.user }],
            },
            model,
            args.temperature ?? 0.2
          )
        );
        tpmBudget.record(model, resp.usage?.input_tokens ?? estimate);
        const text =
          resp.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ??
          '';
        return parseJsonResponse(text);
      }),
    'anthropic_unavailable'
  );

  if (result?.error) {
    const err = new Error(result.reason || result.error);
    err.tag = result.error;
    err.status = result.status ?? null;
    fail('promptJson', err);
    throw err;
  }
  success('promptJson');
  return result;
}

/**
 * Like promptJson but enables Anthropic's server-managed web_search tool.
 * The model may invoke web_search up to maxSearches times; each tool round
 * re-bills the conversation history, so a high maxSearches blows through
 * the TPM budget — we add a multiplier to the pre-call estimate.
 *
 * @param {Anthropic} client
 * @param {{ system: string, user: string, model?: string, maxTokens?: number, temperature?: number, maxSearches?: number }} args
 */
export async function promptWithWebSearchJson(client, args) {
  start('promptWithWebSearchJson');
  const model = args.model || DEFAULT_MODEL;
  const maxSearches = args.maxSearches ?? 8;
  const baseEstimate = estimateInputTokens({
    system: args.system,
    user: args.user,
    toolOverheadTokens: 1_500,
  });
  // web_search re-sends the full conversation each tool round; budget for
  // ~3x typical multi-turn loop (very conservative — most queries use 2–4 searches).
  const estimate = baseEstimate * Math.max(2, Math.min(4, Math.ceil(maxSearches / 3)));
  await tpmBudget.waitForCapacity(model, estimate);

  const breaker = getBreaker(model);
  const result = await breaker.execute(
    async () =>
      callWithBackoff(async () => {
        const resp = await client.messages.create(
          withOptionalTemperature(
            {
              model,
              max_tokens: args.maxTokens ?? 4_000,
              system: args.system,
              tools: [
                {
                  type: 'web_search_20250305',
                  name: 'web_search',
                  max_uses: maxSearches,
                },
              ],
              messages: [{ role: 'user', content: args.user }],
            },
            model,
            args.temperature ?? 0.1
          )
        );
        tpmBudget.record(model, resp.usage?.input_tokens ?? estimate);
        const text =
          resp.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ??
          '';
        return parseJsonResponse(text);
      }),
    'anthropic_unavailable'
  );

  if (result?.error) {
    const err = new Error(result.reason || result.error);
    err.tag = result.error;
    err.status = result.status ?? null;
    fail('promptWithWebSearchJson', err);
    throw err;
  }
  success('promptWithWebSearchJson');
  return result;
}

/**
 * Attempts to parse JSON object even if wrapped in markdown fences.
 * Handles common issues: markdown wrapping, trailing commas, truncation.
 * @param {string} text
 */
function parseJsonResponse(text) {
  // Strip markdown fences
  let cleaned = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }

  // Extract JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Anthropic response missing JSON object');
  let json = match[0];

  // Try parsing the extracted block
  try {
    return JSON.parse(json);
  } catch { /* fall through to repair */ }

  // Attempt repairs: trailing commas before } or ]
  json = json.replace(/,\s*([\]}])/g, '$1');

  // Try again after repair
  try {
    return JSON.parse(json);
  } catch (finalErr) {
    throw new Error(`Failed to parse Anthropic JSON: ${finalErr.message}\nFirst 200 chars: ${json.slice(0, 200)}`);
  }
}
