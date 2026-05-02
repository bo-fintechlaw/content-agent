import { createAnthropicClient, promptWithWebSearchJson } from '../integrations/anthropic.js';
import {
  CLAIM_VERIFICATION_SYSTEM,
  buildClaimVerificationUserPrompt,
} from '../prompts/claim-verification-subagent.js';
import { fail, start, success } from '../utils/logger.js';

const FALLBACK = {
  assessments: [],
  subagent_flags: ['claim_verification_unavailable'],
  subagent_summary:
    'Claim verification subagent could not run; judge without automated fact checks.',
};

/**
 * Web-search-backed factual-claim verification. Runs in parallel with citation subagent
 * inside the judge stage. Returns per-claim verdicts so the judge can lower accuracy
 * and add revision_instructions when claims are contradicted.
 *
 * @param {import('@anthropic-ai/sdk').default | null} anthropicClient
 * @param {Record<string, any>} config
 * @param {{ draft: object }} params
 */
export async function runClaimVerificationSubagent(anthropicClient, config, { draft }) {
  start('runClaimVerificationSubagent', { draftId: draft?.id });

  const client =
    anthropicClient ??
    (config?.ANTHROPIC_API_KEY ? createAnthropicClient(config.ANTHROPIC_API_KEY) : null);
  if (!client) {
    return { ...FALLBACK, subagent_summary: 'No Anthropic client for claim verification subagent.' };
  }

  try {
    const result = await promptWithWebSearchJson(client, {
      model: config.ANTHROPIC_MODEL,
      system: CLAIM_VERIFICATION_SYSTEM,
      user: buildClaimVerificationUserPrompt({ draft }),
      maxTokens: 4_000,
      temperature: 0.1,
      maxSearches: 12,
    });

    if (!result?.assessments || !Array.isArray(result.assessments)) {
      return { ...FALLBACK, subagent_summary: 'Claim subagent returned an invalid shape.' };
    }

    const normalized = result.assessments
      .filter((a) => a && typeof a === 'object' && typeof a.claim === 'string')
      .map((a) => ({
        claim: String(a.claim).trim(),
        verdict: ['supported', 'contradicted', 'unverifiable'].includes(a.verdict)
          ? a.verdict
          : 'unverifiable',
        evidence_url: typeof a.evidence_url === 'string' ? a.evidence_url.trim() : '',
        rationale: typeof a.rationale === 'string' ? a.rationale.trim() : '',
      }));

    const contradictedCount = normalized.filter((a) => a.verdict === 'contradicted').length;

    success('runClaimVerificationSubagent', {
      assessments: normalized.length,
      contradicted: contradictedCount,
    });

    return {
      assessments: normalized,
      subagent_flags: Array.isArray(result.subagent_flags) ? result.subagent_flags : [],
      subagent_summary: result.subagent_summary || '',
      contradicted_count: contradictedCount,
    };
  } catch (e) {
    fail('runClaimVerificationSubagent', e);
    return {
      ...FALLBACK,
      subagent_summary: `Claim verification subagent failed: ${e?.message || e}`,
    };
  }
}
