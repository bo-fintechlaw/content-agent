import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { DEFAULT_SEO_KEYWORDS } from '../config/seo-keywords.js';
import { buildRankerUserPrompt, RANKER_SYSTEM_PROMPT } from '../prompts/ranker-system.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * Stage 2 ranker:
 * - pending topics -> rank/archived
 * - manual suggestions bypass to ranked 10.0
 * - top 3 of auto-ranked topics stay ranked, others archived
 */
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
      success('runTopicRanking', stats);
      return stats;
    }

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);
    const autoScored = [];

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

        const weighted = Number(result.weighted_score ?? 0);
        if (!Number.isFinite(weighted)) throw new Error('weighted_score not numeric');
        autoScored.push({ topicId: topic.id, score: Number(weighted.toFixed(1)) });
      } catch (topicError) {
        stats.failedTopics++;
        fail('runTopicRanking:topic', topicError, { topicId: topic.id, title: topic.title });
      }
    }

    autoScored.sort((a, b) => b.score - a.score);
    const topThree = new Set(autoScored.filter((t) => t.score >= 7.0).slice(0, 3).map((t) => t.topicId));

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

    success('runTopicRanking', stats);
    return stats;
  } catch (error) {
    fail('runTopicRanking', error);
    throw error;
  }
}
