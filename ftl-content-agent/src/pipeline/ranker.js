import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { getKeywordsForCategory } from '../config/seo-keywords.js';
import { getBrand, getEnabledBrands } from '../config/brands/index.js';
import { buildRankerUserPrompt, RANKER_SYSTEM_PROMPT } from '../prompts/ranker-system.js';
import { computeRankerWeightedScore } from './verdict.js';
import { formatHintsForPrompt, getRankerPerformanceHints } from './analytics-feedback.js';
import { shouldSkipPendingTopicForOverlap } from './prior-posts.js';
import { fail, start, success } from '../utils/logger.js';

const DEFAULT_MIN_RELEVANCE = 7.0;
const DEFAULT_BACKFILL_FLOOR = 5.5;
const DEFAULT_BACKFILL_TARGET = 5;
const DEFAULT_BATCH_LIMIT = 75;

function minRelevanceFromConfig(config) {
  const m = config?.DAILY_PUBLISH_MIN_RELEVANCE;
  return m != null && Number.isFinite(Number(m)) ? Number(m) : DEFAULT_MIN_RELEVANCE;
}

function backfillFloorFromConfig(config) {
  const f = config?.DAILY_PUBLISH_BACKFILL_FLOOR;
  return f != null && Number.isFinite(Number(f)) ? Number(f) : DEFAULT_BACKFILL_FLOOR;
}

function backfillTargetFromConfig(config, options = {}) {
  if (options.backfillTarget != null && Number.isFinite(Number(options.backfillTarget))) {
    return Number(options.backfillTarget);
  }
  const t = config?.DAILY_PUBLISH_BACKFILL_TARGET;
  return t != null && Number.isFinite(Number(t)) ? Number(t) : DEFAULT_BACKFILL_TARGET;
}

function batchLimitFromConfig(config, options = {}) {
  if (options.batchLimit != null && Number.isFinite(Number(options.batchLimit))) {
    return Number(options.batchLimit);
  }
  const raw = config?.RANK_BATCH_LIMIT ?? process.env.RANK_BATCH_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_LIMIT;
}

function buildEmptyReport(config, options = {}) {
  return {
    minRelevance: minRelevanceFromConfig(config),
    backfillFloor: backfillFloorFromConfig(config),
    backfillTarget: backfillTargetFromConfig(config, options),
    auto: [],
    manual: [],
    countAutoScoredAtOrAboveMin: 0,
    countAllScoredAtOrAboveMin: 0,
    countBackfilled: 0,
    skippedOverlap: 0,
  };
}

function rankerPromptForBrand(brandId) {
  const brand = getBrand(brandId);
  return {
    system: brand.prompts.rankerSystem ?? RANKER_SYSTEM_PROMPT,
    buildUser: brand.prompts.buildRankerUser ?? buildRankerUserPrompt,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 * @param {{ batchLimit?: number, backfillTarget?: number }} [options]
 */
export async function runTopicRanking(supabase, config, options = {}) {
  start('runTopicRanking');
  const stats = {
    processed: 0,
    ranked: 0,
    backfilled: 0,
    archived: 0,
    bypassedManual: 0,
    failedTopics: 0,
    skippedOverlap: 0,
  };

  try {
    const enabledBrandIds = getEnabledBrands(config).map((b) => b.id);
    const batchLimit = batchLimitFromConfig(config, options);

    const { data: topics, error } = await supabase
      .from('content_topics')
      .select('id,title,summary,source_url,category,suggested_by,created_at,status,brand_id')
      .eq('status', 'pending')
      .in('brand_id', enabledBrandIds)
      .order('created_at', { ascending: true })
      .limit(batchLimit);
    if (error) throw new Error(error.message);
    if (!topics?.length) {
      const empty = buildEmptyReport(config, options);
      success('runTopicRanking', stats);
      return { ...stats, report: empty };
    }

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);
    const minRel = minRelevanceFromConfig(config);
    const floor = backfillFloorFromConfig(config);
    const target = backfillTargetFromConfig(config, options);
    const performanceHints = formatHintsForPrompt(
      await getRankerPerformanceHints(supabase)
    );
    const autoScored = [];
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

      const brandId = topic.brand_id ?? 'fintechlaw';
      const skipOverlap = await shouldSkipPendingTopicForOverlap(supabase, {
        topic,
        brandId,
      });
      if (skipOverlap) {
        stats.skippedOverlap++;
        const { error: archErr } = await supabase
          .from('content_topics')
          .update({ status: 'archived', updated_at: new Date().toISOString() })
          .eq('id', topic.id);
        if (archErr) throw new Error(archErr.message);
        stats.archived++;
        continue;
      }

      try {
        const { system, buildUser } = rankerPromptForBrand(brandId);
        const result = await promptJson(client, {
          model: config.ANTHROPIC_MODEL,
          system,
          user: buildUser({
            topic,
            seoKeywords: getKeywordsForCategory(topic.category),
            performanceHints,
          }),
          maxTokens: 900,
          temperature: 0.1,
        });

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

    const passingIds = new Set(
      autoScored.filter((t) => t.score >= minRel).map((t) => t.topicId)
    );
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
      skippedOverlap: stats.skippedOverlap,
    };

    success('runTopicRanking', stats);
    return { ...stats, report };
  } catch (error) {
    fail('runTopicRanking', error);
    throw error;
  }
}
