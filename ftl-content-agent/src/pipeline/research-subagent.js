import { createAnthropicClient, promptWithWebSearchJson } from '../integrations/anthropic.js';
import {
  RESEARCH_SUBAGENT_SYSTEM,
  buildResearchUserPrompt,
} from '../prompts/research-subagent.js';
import { fail, start, success } from '../utils/logger.js';

const FALLBACK = {
  facts: [],
  primary_sources: [],
  open_questions: [],
  summary: '',
  unavailable: true,
};

/**
 * Pre-draft web-search subagent. Returns a compact "verified facts" brief that
 * the drafter user prompt embeds verbatim — anchoring dates, status, figures,
 * and primary URLs against confabulation from the drafter's stale training data.
 *
 * Best-effort: a failure here returns an empty brief and the drafter proceeds
 * as before. The post-draft claim-verification subagent still runs in the judge.
 *
 * @param {import('@anthropic-ai/sdk').default | null} anthropicClient
 * @param {Record<string, any>} config
 * @param {{ topic: object }} params
 */
export async function runResearchSubagent(anthropicClient, config, { topic }) {
  start('runResearchSubagent', { topicId: topic?.id });

  const client =
    anthropicClient ??
    (config?.ANTHROPIC_API_KEY ? createAnthropicClient(config.ANTHROPIC_API_KEY) : null);
  if (!client) {
    return { ...FALLBACK, summary: 'No Anthropic client for research subagent.' };
  }

  try {
    const result = await promptWithWebSearchJson(client, {
      model: config.ANTHROPIC_SUBAGENT_MODEL || config.ANTHROPIC_MODEL,
      system: RESEARCH_SUBAGENT_SYSTEM,
      user: buildResearchUserPrompt({ topic }),
      maxTokens: 4_000,
      temperature: 0.1,
      maxSearches: 10,
    });

    if (!result || typeof result !== 'object') {
      return { ...FALLBACK, summary: 'Research subagent returned an invalid shape.' };
    }

    const facts = Array.isArray(result.facts)
      ? result.facts
          .filter(
            (f) =>
              f &&
              typeof f === 'object' &&
              typeof f.label === 'string' &&
              typeof f.value === 'string' &&
              typeof f.source_url === 'string' &&
              f.source_url.trim().startsWith('http')
          )
          .slice(0, 8)
          .map((f) => ({
            label: String(f.label).trim().slice(0, 120),
            value: String(f.value).trim().slice(0, 400),
            source_url: String(f.source_url).trim(),
            confidence: ['high', 'medium', 'low'].includes(f.confidence)
              ? f.confidence
              : 'medium',
          }))
      : [];

    const primarySources = Array.isArray(result.primary_sources)
      ? result.primary_sources
          .filter((u) => typeof u === 'string' && u.trim().startsWith('http'))
          .slice(0, 5)
          .map((u) => u.trim())
      : [];

    const openQuestions = Array.isArray(result.open_questions)
      ? result.open_questions
          .filter((q) => typeof q === 'string' && q.trim())
          .slice(0, 6)
          .map((q) => String(q).trim().slice(0, 300))
      : [];

    success('runResearchSubagent', {
      topicId: topic?.id,
      factsCount: facts.length,
      openCount: openQuestions.length,
    });

    return {
      facts,
      primary_sources: primarySources,
      open_questions: openQuestions,
      summary: typeof result.summary === 'string' ? result.summary : '',
    };
  } catch (e) {
    fail('runResearchSubagent', e, { topicId: topic?.id });
    return {
      ...FALLBACK,
      summary: `Research subagent failed: ${e?.message || e}`,
    };
  }
}

/**
 * Render a research brief as a plain-text block to inject into the drafter
 * user prompt. Empty brief returns an empty string so the drafter prompt
 * stays clean when research is unavailable.
 *
 * @param {{ facts: Array, primary_sources: Array, open_questions: Array, summary: string } | null} brief
 */
export function renderResearchBriefForDrafter(brief) {
  if (!brief || (!brief.facts?.length && !brief.open_questions?.length)) {
    return '';
  }
  const factsBlock = (brief.facts ?? [])
    .map(
      (f, i) =>
        `${i + 1}. ${f.label} — ${f.value}\n   Primary source: ${f.source_url} (confidence: ${f.confidence})`
    )
    .join('\n');
  const sourcesBlock = (brief.primary_sources ?? []).length
    ? `\n\nADDITIONAL PRIMARY SOURCES (consider citing inline if relevant):\n${brief.primary_sources
        .map((u, i) => `${i + 1}. ${u}`)
        .join('\n')}`
    : '';
  const openBlock = (brief.open_questions ?? []).length
    ? `\n\nUNVERIFIED / OPEN QUESTIONS — do NOT invent values for these. Omit the claim or hedge with explicit attribution:\n${brief.open_questions
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n')}`
    : '';
  const summaryBlock = brief.summary ? `\n\nSubagent summary: ${brief.summary}` : '';
  return `
VERIFIED FACTS — USE THESE EXACTLY (do not paraphrase dates or figures):
${factsBlock || '(no facts surfaced)'}${sourcesBlock}${openBlock}${summaryBlock}

These facts override any conflicting recollection from training data. When you cite a fact above, use its primary_source URL as the inline Markdown link.
`.trim();
}
