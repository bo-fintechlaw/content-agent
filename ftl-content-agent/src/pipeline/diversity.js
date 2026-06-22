/**
 * Topic-selection diversity guard (brand-scoped).
 *
 * Penalty axes (FTL_Editorial_Intelligence_v1.md §2.1):
 *   - same source name within RECENT_WINDOW_DAYS: -2.0 (cumulative per match)
 *   - same category within RECENT_WINDOW_DAYS:    -1.0 per match
 *   - topic-title trigram similarity vs recent publishes: up to -2.0
 */

export const RECENT_WINDOW_DAYS = 7;
export const SAME_SOURCE_PENALTY = 2.0;
export const SAME_CATEGORY_PENALTY = 1.0;
export const TITLE_SIMILARITY_PENALTY = 2.0;
export const TITLE_SIMILARITY_THRESHOLD = 0.45;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ brandId?: string | null }} [options]
 */
export async function fetchRecentlyPublished(supabase, options = {}) {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();
  const brandId = options.brandId ?? null;

  let data = null;
  try {
    let q = supabase
      .from('content_drafts')
      .select(
        'published_at, blog_title, brand_id, content_topics!inner(source_name, category, brand_id)'
      )
      .not('published_at', 'is', null)
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(50);
    if (brandId) q = q.eq('brand_id', brandId);
    const result = await q;
    if (result?.error) return [];
    data = result?.data ?? null;
  } catch {
    return [];
  }

  return (data ?? []).map((row) => ({
    source_name: row.content_topics?.source_name ?? null,
    category: row.content_topics?.category ?? null,
    brand_id: row.brand_id ?? row.content_topics?.brand_id ?? null,
    blog_title: row.blog_title ?? null,
    published_at: row.published_at,
  }));
}

/**
 * @param {Array<Record<string, any>>} candidates
 * @param {Array<{ source_name: string|null, category: string|null, blog_title?: string|null, brand_id?: string|null }>} recent
 */
export function applyDiversityPenalty(candidates, recent) {
  const safeRecent = Array.isArray(recent) ? recent : [];
  return (candidates ?? [])
    .map((topic) => {
      const reasons = [];
      const rawScore = Number(topic.relevance_score ?? 0);
      let penalty = 0;

      const candBrand = String(topic.brand_id ?? 'fintechlaw').trim();
      const brandRecent = safeRecent.filter(
        (r) => String(r.brand_id ?? 'fintechlaw').trim() === candBrand
      );

      const candSource = String(topic.source_name ?? '').trim().toLowerCase();
      const candCategory = String(topic.category ?? '').trim().toLowerCase();
      const candTitle = String(topic.title ?? '').trim();

      let sourceHits = 0;
      let categoryHits = 0;
      for (const r of brandRecent) {
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

      const titleSim = maxTitleSimilarity(
        candTitle,
        brandRecent.map((r) => r.blog_title).filter(Boolean)
      );
      if (titleSim >= TITLE_SIMILARITY_THRESHOLD) {
        penalty += TITLE_SIMILARITY_PENALTY;
        reasons.push(`title_similarity:${titleSim.toFixed(2)}@-${TITLE_SIMILARITY_PENALTY}`);
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

/** @param {string} title @param {string[]} publishedTitles */
export function maxTitleSimilarity(title, publishedTitles) {
  const a = trigrams(normalizeTitle(title));
  if (!a.size) return 0;
  let max = 0;
  for (const pub of publishedTitles) {
    const b = trigrams(normalizeTitle(String(pub)));
    if (!b.size) continue;
    max = Math.max(max, jaccard(a, b));
  }
  return max;
}

function normalizeTitle(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(text) {
  const set = new Set();
  const padded = `  ${text}  `;
  for (let i = 0; i < padded.length - 2; i += 1) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}
