/**
 * Topic-selection diversity guard.
 *
 * The drafter's picker sorts ranked topics by relevance_score. Without a
 * diversity check, a stretch of strong same-source / same-category news (e.g.
 * three days of crypto headlines from PYMNTS) lines up three same-shaped
 * publications in a row. Real editorial calendars don't behave that way; this
 * helper applies penalties when a candidate looks like recent material.
 *
 * Penalty axes (FTL_Editorial_Intelligence_v1.md §2.1):
 *   - same source name within RECENT_WINDOW_DAYS: -2.0 (cumulative per match)
 *   - same category within RECENT_WINDOW_DAYS:    -1.0 per match
 *   - topic-title similarity: deferred to Phase 2 (needs prior-posts index)
 *
 * The picker still always prefers a higher *adjusted* score, breaking ties on
 * raw score. A genuinely better story beats diversity — the goal is to
 * prevent runs of near-duplicates, not to randomize selection.
 */

export const RECENT_WINDOW_DAYS = 7;
export const SAME_SOURCE_PENALTY = 2.0;
export const SAME_CATEGORY_PENALTY = 1.0;

/**
 * Pull source/category metadata for blog drafts published in the last
 * RECENT_WINDOW_DAYS. We join through content_topics because content_drafts
 * doesn't carry source_name / category directly. Returns one entry per
 * published draft (newest first).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Array<{ source_name: string|null, category: string|null, published_at: string }>>}
 */
export async function fetchRecentlyPublished(supabase) {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();
  // Fail open on any error (including test mocks that don't model the chain
  // we want). Diversity is a quality-of-output enhancement, not a correctness
  // gate; a query error or partial mock should not block today's draft.
  let data = null;
  try {
    const result = await supabase
      .from('content_drafts')
      .select('published_at, content_topics!inner(source_name, category)')
      .not('published_at', 'is', null)
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(50);
    if (result?.error) return [];
    data = result?.data ?? null;
  } catch {
    return [];
  }
  return (data ?? []).map((row) => ({
    source_name: row.content_topics?.source_name ?? null,
    category: row.content_topics?.category ?? null,
    published_at: row.published_at,
  }));
}

/**
 * Adjust each candidate's score by its diversity penalty against `recent`.
 * Returns a new array sorted by adjustedScore desc, then rawScore desc.
 *
 * Each candidate is expected to expose `relevance_score`, `source_name`, and
 * `category`. Missing fields are treated as never-matching (no penalty).
 *
 * @param {Array<Record<string, any>>} candidates
 * @param {Array<{ source_name: string|null, category: string|null }>} recent
 */
export function applyDiversityPenalty(candidates, recent) {
  const safeRecent = Array.isArray(recent) ? recent : [];
  return (candidates ?? [])
    .map((topic) => {
      const reasons = [];
      const rawScore = Number(topic.relevance_score ?? 0);
      let penalty = 0;

      const candSource = String(topic.source_name ?? '').trim().toLowerCase();
      const candCategory = String(topic.category ?? '').trim().toLowerCase();

      let sourceHits = 0;
      let categoryHits = 0;
      for (const r of safeRecent) {
        const rs = String(r.source_name ?? '').trim().toLowerCase();
        const rc = String(r.category ?? '').trim().toLowerCase();
        if (candSource && rs && rs === candSource) sourceHits += 1;
        if (candCategory && rc && rc === candCategory) categoryHits += 1;
      }

      if (sourceHits > 0) {
        penalty += SAME_SOURCE_PENALTY * sourceHits;
        reasons.push(
          `same_source:${candSource}:${sourceHits}@-${SAME_SOURCE_PENALTY * sourceHits}`
        );
      }
      if (categoryHits > 0) {
        penalty += SAME_CATEGORY_PENALTY * categoryHits;
        reasons.push(
          `same_category:${candCategory}:${categoryHits}@-${SAME_CATEGORY_PENALTY * categoryHits}`
        );
      }

      return {
        topic,
        rawScore,
        penalty,
        adjustedScore: Math.max(0, rawScore - penalty),
        reasons,
      };
    })
    .sort((a, b) => b.adjustedScore - a.adjustedScore || b.rawScore - a.rawScore);
}
