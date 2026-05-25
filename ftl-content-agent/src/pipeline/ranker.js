import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { getKeywordsForCategory } from '../config/seo-keywords.js';
import { buildRankerUserPrompt, RANKER_SYSTEM_PROMPT } from '../prompts/ranker-system.js';
import { computeRankerWeightedScore } from './verdict.js';
import { formatHintsForPrompt, getRankerPerformanceHints } from './analytics-feedback.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * Stage 2 ranker:
 * - pending topics -> ranked/archived
 * - manual suggestions bypass to ranked 10.0
 * - every topic at or above DAILY_PUBLISH_MIN_RELEVANCE advances (no count cap)
 * - if fewer than DAILY_PUBLISH_BACKFILL_TARGET clear the min, backfill with the
 *   next-highest topics down to DAILY_PUBLISH_BACKFILL_FLOOR so the pipeline
 *   doesn't starve on slow news days
 */
const DEFAULT_MIN_RELEVANCE = 7.0;
const DEFAULT_BACKFILL_FLOOR = 5.5;
const DEFAULT_BACKFILL_TARGET = 3;

function minRelevanceFromConfig(config) {
  const m = config?.DAILY_PUBLISH_MIN_RELEVANCE;
  return m != null && Number.isFinite(Number(m)) ? Number(m) : DEFAULT_MIN_RELEVANCE;
}

function backfillFloorFromConfig(config) {
  const f = config?.DAILY_PUBLISH_BACKFILL_FLOOR;
  return f != null && Number.isFinite(Number(f)) ? Number(f) : DEFAULT_BACKFILL_FLOOR;
}

function backfillTargetFromConfig(config) {
  const t = config?.DAILY_PUBLISH_BACKFILL_TARGET;
  return t != null && Number.isFinite(Number(t)) ? Number(t) : DEFAULT_BACKFILL_TARGET;
}

function buildEmptyReport(config) {
  return {
    minRelevance: minRelevanceFromConfig(config),
    backfillFloor: backfillFloorFromConfig(config),
    backfillTarget: backfillTargetFromConfig(config),
    auto: /** @type {Array<{ title: string, score: number, outcome: 'ranked' | 'backfilled' | 'archived' }> } */ ([]),
    manual: /** @type {Array<{ title: string, score: number, outcome: 'ranked' }> } */ ([]),
    countAutoScoredAtOrAboveMin: 0,
    countAllScoredAtOrAboveMin: 0,
    countBackfilled: 0,
  };
}

export async function runTopicRanking(supabase, config) {
  start('runTopicRanking');
  const stats = {
    processed: 0,
    ranked: 0,
    backfilled: 0,
    archived: 0,
    bypassedManual: 0,
    failedTopics: 0,
  };

  try {
    const { data: topics, error } = await supabase
      .from('content_topics')
      .select('id,title,summary,source_url,category,suggested_by,created_at,status')
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
    const floor = backfillFloorFromConfig(config);
    const target = backfillTargetFromConfig(config);
    // Pull performance hints once per run. Same hints feed every per-topic
    // call so the ranker's anchors are stable across the batch.
    const performanceHints = formatHintsForPrompt(
      await getRankerPerformanceHints(supabase)
    );
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
          user: buildRankerUserPrompt({
            topic,
            seoKeywords: getKeywordsForCategory(topic.category),
            performanceHints,
          }),
          maxTokens: 900,
          temperature: 0.1,
        });

        // Composite is computed in code (single source of truth in verdict.js).
        // Any weighted_score the LLM happens to return is ignored.
        // Pass sourceUrl so a regulator press release gets the +1.0 primary-
        // source boost — see PRIMARY_REGULATOR_HOSTS in verdict.js.
        const weighted = computeRankerWeightedScore(result.scores, {
          sourceUrl: topic.source_url,
        });
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

    // Tier 1: every topic at or above the minimum relevance advances.
    const passingIds = new Set(
      autoScored.filter((t) => t.score >= minRel).map((t) => t.topicId)
    );
    // Tier 2: if too few cleared the bar, backfill with the next-highest
    // topics down to the floor until we hit the daily target.
    const backfilledIds = new Set();
    if (passingIds.size < target) {
      for (const t of autoScored) {
        if (passingIds.has(t.topicId)) continue;
        if (t.score < floor) break;
        backfilledIds.add(t.topicId);
        if (passingIds.size + backfilledIds.size >= target) break;
      }
    }

    for (const row of autoScored) {
      const isPassing = passingIds.has(row.topicId);
      const isBackfill = backfilledIds.has(row.topicId);
      const nextStatus = isPassing || isBackfill ? 'ranked' : 'archived';
      const { error: upErr } = await supabase
        .from('content_topics')
        .update({
          relevance_score: row.score,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.topicId);
      if (upErr) throw new Error(upErr.message);
      if (isPassing) stats.ranked++;
      else if (isBackfill) {
        stats.ranked++;
        stats.backfilled++;
      } else stats.archived++;
    }

    const countAutoGteMin = autoScored.filter((r) => r.score >= minRel).length;
    const countManualGteMin = manualRanked.filter((r) => r.score >= minRel).length;
    const report = {
      minRelevance: minRel,
      backfillFloor: floor,
      backfillTarget: target,
      auto: autoScored.map((row) => ({
        title: row.title,
        score: row.score,
        outcome: passingIds.has(row.topicId)
          ? 'ranked'
          : backfilledIds.has(row.topicId)
            ? 'backfilled'
            : 'archived',
      })),
      manual: manualRanked,
      countAutoScoredAtOrAboveMin: countAutoGteMin,
      countAllScoredAtOrAboveMin: countAutoGteMin + countManualGteMin,
      countBackfilled: backfilledIds.size,
    };

    success('runTopicRanking', stats);
    return { ...stats, report };
  } catch (error) {
    fail('runTopicRanking', error);
    throw error;
  }
}
