import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import {
  CITATION_SUBAGENT_SYSTEM,
  buildCitationSubagentUserPrompt,
} from '../prompts/citation-subagent.js';
import { start, success, fail } from '../utils/logger.js';

const FALLBACK = {
  assessments: [],
  subagent_flags: ['citation_subagent_unavailable'],
  subagent_summary: 'Link verification subagent could not run; judge without automated citation checks.',
};

/**
 * Second LLM pass: compare draft to fetched page previews. Called before the main judge.
 * @param {import('@anthropic-ai/sdk').default} [client] — pre-built client, or null to create from config
 * @param {Record<string, any>} config
 * @param {{ draft: object, fetches: Array}} params
 */
export async function runCitationVerificationSubagent(anthropicClient, config, { draft, fetches }) {
  if (!fetches?.length) {
    return {
      ...FALLBACK,
      subagent_summary: 'No http(s) URLs in draft to verify.',
      subagent_flags: [],
    };
  }
  start('runCitationVerificationSubagent', { fetchCount: fetches.length });
  const client =
    anthropicClient ?? (config?.ANTHROPIC_API_KEY ? createAnthropicClient(config.ANTHROPIC_API_KEY) : null);
  if (!client) {
    return { ...FALLBACK, subagent_summary: 'No Anthropic client for citation subagent.' };
  }
  try {
    const result = await promptJson(client, {
      model: config.ANTHROPIC_MODEL,
      system: CITATION_SUBAGENT_SYSTEM,
      user: buildCitationSubagentUserPrompt({ draft, fetches }),
      maxTokens: 2_200,
      temperature: 0.1,
    });
    success('runCitationVerificationSubagent', {
      assessments: result?.assessments?.length ?? 0,
    });
    if (!result?.assessments || !Array.isArray(result.assessments)) {
      return { ...FALLBACK, subagent_summary: 'Subagent returned an invalid shape.' };
    }
    return {
      assessments: result.assessments,
      subagent_flags: result.subagent_flags || [],
      subagent_summary: result.subagent_summary || '',
    };
  } catch (e) {
    fail('runCitationVerificationSubagent', e);
    return {
      ...FALLBACK,
      subagent_summary: `Citation subagent failed: ${e?.message || e}`,
    };
  }
}
