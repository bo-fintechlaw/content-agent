import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('sanity-agent-actions');

/**
 * Uses Sanity Agent Actions to generate the share image asset asynchronously.
 * Note: this may require @sanity/assist setup in the Sanity Studio.
 *
 * @param {object} params
 * @param {import('@sanity/client').Client} params.client
 * @param {string} params.schemaId
 * @param {string} params.documentId
 * @param {string} params.instruction
 * @param {number} [params.timeoutMs]
 */
export async function generateShareImageWithAgentActions({
  client,
  schemaId,
  documentId,
  instruction,
  timeoutMs = 30000,
}) {
  start('generateShareImageWithAgentActions', { schemaId, documentId });

  if (!client?.agent?.action?.generate) {
    // Not available in some Sanity client runtimes; treat as non-fatal.
    return {
      ok: false,
      error: 'Sanity client does not expose client.agent.action.generate',
    };
  }

  const result = await breaker.execute(
    () =>
      client.agent.action.generate({
        schemaId,
        documentId,
        instruction,
        target: [{ path: ['shareImage', 'asset'] }],
      }),
    { ok: false, error: 'sanity_agent_actions_unavailable' }
  );

  if (!result?.ok && result?.error) {
    fail('generateShareImageWithAgentActions', new Error(result.error));
    return { ok: false, error: result.error };
  }

  success('generateShareImageWithAgentActions');
  return { ok: true };
}

