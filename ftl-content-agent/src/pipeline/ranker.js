import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { DEFAULT_SEO_KEYWORDS } from '../config/seo-keywords.js';
import { buildRankerUserPrompt, RANKER_SYSTEM_PROMPT } from '../prompts/ranker-system.js';
import { computeRankerWeightedScore } from './verdict.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * Stage 2 ranker:
 * - pending topics -> rank/archived
 * - manual suggestions bypass to ranked 10.0
 * - top 3 of auto-ranked topics stay ranked, others archived
 */
const RANKER_TOP3_CUTOFF = 7.0; // auto: top 3 of pending with score >= this (see loop below)

function minRelevanceFromConfig(config) {
  const m = config?.DAILY_PUBLISH_MIN_RELEVANCE;
  return m != null && Number.isFinite(m) ? m : 7.0;
}

function buildEmptyReport(config) {
  const min = minRelevanceFromConfig(config);
  return {
    minRelevance: min,
    rankerTop3Cutoff: RANKER_TOP3_CUTOFF,
    auto: /** @type {Array<{ title: string, score: number, outcome: 'ranked' | 'archived' }> } */ ([]),
    manual: /** @type {Array<{ title: string, score: number, outcome: 'ranked' }> } */ ([]),
    countAutoScoredAtOrAboveMin: 0,
    countAllScoredAtOrAboveMin: 0,
  };
}

export async function runTopicRanking(supabase, config) {
  start('runTopicRanking');
  const stats = {
    processed: 0,
    ranked: 0,
    archived: 0,
    bypassedManual: 0,
    failedTopics: 0,
  };

  try {
    const { data: topics, error } = await supabase
      .from('content_topics')
      .select('id,title,summary,category,suggested_by,created_at,status')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    if (!topics?.length) {
      const empty = buildEmptyReport(config);
      success('runTopicRanking', stats);
      return { ...stats, report: empty };
    }

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);
    const minRel = minRelevanceFromConfig(config);
    const autoScored = [];
    /** @type {Array<{ title: string, score: number, outcome: 'ranked' }>} */
    const manualRanked = [];

    for (const topic of topics) {
      stats.processed++;
      if (topic.suggested_by === 'manual') {
        const { error: upErr } = await supabase
          .from('content_topics')
          .update({ relevance_score: 10.0, status: 'ranked', updated_at: new Date().toISOString() })
          .eq('id', topic.id);
        if (upErr) throw new Error(upErr.message);
        stats.ranked++;
        stats.bypassedManual++;
        manualRanked.push({
          title: String(topic.title ?? 'Untitled').slice(0, 200),
          score: 10.0,
          outcome: 'ranked',
        });
        continue;
      }

      try {
        const result = await promptJson(client, {
          model: config.ANTHROPIC_MODEL,
          system: RANKER_SYSTEM_PROMPT,
          user: buildRankerUserPrompt({ topic, seoKeywords: DEFAULT_SEO_KEYWORDS }),
          maxTokens: 900,
          temperature: 0.1,
        });

        // Composite is computed in code (single source of truth in verdict.js).
        // Any weighted_score the LLM happens to return is ignored.
        const weighted = computeRankerWeightedScore(result.scores);
        autoScored.push({
          topicId: topic.id,
          title: String(topic.title ?? 'Untitled').slice(0, 200),
          score: weighted,
        });
      } catch (topicError) {
        stats.failedTopics++;
        fail('runTopicRanking:topic', topicError, { topicId: topic.id, title: topic.title });
      }
    }

    autoScored.sort((a, b) => b.score - a.score);
    const topThree = new Set(
      autoScored.filter((t) => t.score >= RANKER_TOP3_CUTOFF).slice(0, 3).map((t) => t.topicId)
    );

    for (const row of autoScored) {
      const nextStatus = topThree.has(row.topicId) ? 'ranked' : 'archived';
      const { error: upErr } = await supabase
        .from('content_topics')
        .update({
          relevance_score: row.score,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.topicId);
      if (upErr) throw new Error(upErr.message);
      if (nextStatus === 'ranked') stats.ranked++;
      else stats.archived++;
    }

    const countAutoGteMin = autoScored.filter((r) => r.score >= minRel).length;
    const countManualGteMin = manualRanked.filter((r) => r.score >= minRel).length;
    const report = {
      minRelevance: minRel,
      rankerTop3Cutoff: RANKER_TOP3_CUTOFF,
      auto: autoScored.map((row) => ({
        title: row.title,
        score: row.score,
        outcome: topThree.has(row.topicId) ? 'ranked' : 'archived',
      })),
      manual: manualRanked,
      countAutoScoredAtOrAboveMin: countAutoGteMin,
      countAllScoredAtOrAboveMin: countAutoGteMin + countManualGteMin,
    };

    success('runTopicRanking', stats);
    return { ...stats, report };
  } catch (error) {
    fail('runTopicRanking', error);
    throw error;
  }
}
