import Anthropic from '@anthropic-ai/sdk';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('anthropic');

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
  const result = await breaker.execute(
    async () => {
      const resp = await client.messages.create({
        model: args.model ?? 'claude-sonnet-4-6',
        max_tokens: args.maxTokens ?? 1800,
        temperature: args.temperature ?? 0.2,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      });
      const text =
        resp.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ??
        '';
      return parseJsonResponse(text);
    },
    { error: 'anthropic_unavailable' }
  );

  if (result?.error) {
    fail('promptJson', new Error(result.error));
    throw new Error(result.error);
  }
  success('promptJson');
  return result;
}

/**
 * Like promptJson but enables Anthropic's server-managed web_search tool.
 * The model may invoke web_search up to maxSearches times during a single turn;
 * Anthropic runs the searches and returns the model's final text response.
 *
 * @param {Anthropic} client
 * @param {{ system: string, user: string, model?: string, maxTokens?: number, temperature?: number, maxSearches?: number }} args
 */
export async function promptWithWebSearchJson(client, args) {
  start('promptWithWebSearchJson');
  const result = await breaker.execute(
    async () => {
      const resp = await client.messages.create({
        model: args.model ?? 'claude-sonnet-4-6',
        max_tokens: args.maxTokens ?? 4_000,
        temperature: args.temperature ?? 0.1,
        system: args.system,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: args.maxSearches ?? 8,
          },
        ],
        messages: [{ role: 'user', content: args.user }],
      });
      const text =
        resp.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ??
        '';
      return parseJsonResponse(text);
    },
    { error: 'anthropic_unavailable' }
  );

  if (result?.error) {
    fail('promptWithWebSearchJson', new Error(result.error));
    throw new Error(result.error);
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
