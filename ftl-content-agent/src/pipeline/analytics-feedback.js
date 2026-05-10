/**
 * Analytics → ranker feedback. Reads imported LinkedIn + GSC analytics out
 * of `content_analytics` and surfaces three signals to the ranker:
 *
 *   1. topPosts            - LinkedIn posts that drove the most impressions.
 *                            Anchors the ranker on what audience patterns work.
 *   2. nearMissQueries     - GSC queries with real impressions but ranking
 *                            outside the top page (position 20-70). These are
 *                            content gaps the ranker should boost when a
 *                            topic could capture them.
 *   3. ctrGapPages         - Pages that rank well (position <= 15) but lose
 *                            CTR (< 0.5%). Demand exists; topic-relevant new
 *                            posts can capture the SERP traffic.
 *
 * Cached in-process for 1 hour. Hints change when CSVs are imported (rare),
 * so we accept slightly-stale data in exchange for not re-querying on every
 * topic ranking call.
 */

import { fail, start, success } from '../utils/logger.js';

let cached = null;
let cachedAt = 0;
const TTL_MS = 60 * 60 * 1000;

export function clearRankerHintsCache() {
  cached = null;
  cachedAt = 0;
}

export async function getRankerPerformanceHints(supabase, { force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;
  start('getRankerPerformanceHints');
  try {
    const [topPosts, nearMissQueries, ctrGapPages] = await Promise.all([
      fetchTopLinkedInPosts(supabase),
      fetchNearMissQueries(supabase),
      fetchCtrGapPages(supabase),
    ]);
    const hints = { topPosts, nearMissQueries, ctrGapPages };
    cached = hints;
    cachedAt = Date.now();
    success('getRankerPerformanceHints', {
      topPosts: topPosts.length,
      nearMissQueries: nearMissQueries.length,
      ctrGapPages: ctrGapPages.length,
    });
    return hints;
  } catch (err) {
    fail('getRankerPerformanceHints', err);
    return null;
  }
}

async function fetchTopLinkedInPosts(supabase) {
  const { data, error } = await supabase
    .from('content_analytics')
    .select('draft_id, impressions, engagements, raw_data')
    .eq('platform', 'linkedin')
    .eq('metric_kind', 'linkedin_post')
    .order('impressions', { ascending: false })
    .limit(20);
  if (error || !Array.isArray(data)) return [];

  const draftIds = data.map((r) => r.draft_id).filter(Boolean);
  const drafts = new Map();
  if (draftIds.length) {
    const { data: rows } = await supabase
      .from('content_drafts')
      .select('id, blog_title')
      .in('id', draftIds);
    for (const row of rows ?? []) drafts.set(row.id, row);
  }

  return data.slice(0, 5).map((r) => {
    const draft = drafts.get(r.draft_id) ?? null;
    return {
      title: draft?.blog_title ?? r.raw_data?.title ?? '(unattributed)',
      impressions: r.impressions ?? 0,
      engagements: r.engagements ?? 0,
    };
  });
}

async function fetchNearMissQueries(supabase) {
  const { data, error } = await supabase
    .from('content_analytics')
    .select('query, impressions, position, period_end')
    .eq('metric_kind', 'gsc_query')
    .order('period_end', { ascending: false })
    .limit(500);
  if (error || !Array.isArray(data) || !data.length) return [];

  const latestPeriod = data[0]?.period_end ?? null;
  const latestRows = data.filter((r) => r.period_end === latestPeriod);

  return latestRows
    .filter(
      (r) =>
        Number(r.impressions ?? 0) >= 100 &&
        Number(r.position ?? 999) >= 20 &&
        Number(r.position ?? 999) <= 70
    )
    .sort((a, b) => Number(b.impressions ?? 0) - Number(a.impressions ?? 0))
    .slice(0, 8)
    .map((r) => ({
      query: r.query,
      impressions: Number(r.impressions ?? 0),
      position: Number(r.position ?? 0),
    }));
}

async function fetchCtrGapPages(supabase) {
  const { data, error } = await supabase
    .from('content_analytics')
    .select('url, impressions, clicks, position, period_end')
    .eq('metric_kind', 'gsc_page')
    .order('period_end', { ascending: false })
    .limit(500);
  if (error || !Array.isArray(data) || !data.length) return [];

  const latestPeriod = data[0]?.period_end ?? null;
  const latestRows = data.filter((r) => r.period_end === latestPeriod);

  return latestRows
    .map((r) => {
      const impressions = Number(r.impressions ?? 0);
      const clicks = Number(r.clicks ?? 0);
      const ctr = impressions > 0 ? clicks / impressions : 0;
      return { url: r.url, impressions, ctr, position: Number(r.position ?? 0) };
    })
    .filter((r) => r.impressions >= 500 && r.position > 0 && r.position <= 15 && r.ctr < 0.005)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5);
}

/**
 * Render hints as a compact prompt block. Returns '' when no hints — the
 * ranker prompt then omits the section entirely so we don't introduce
 * "(none)" noise that the LLM might over-weight.
 */
export function formatHintsForPrompt(hints) {
  if (!hints) return '';
  const top = (hints.topPosts ?? []).map(
    (t) => `- "${t.title}" — ${t.impressions} impressions, ${t.engagements} engagements`
  );
  const near = (hints.nearMissQueries ?? []).map(
    (q) => `- "${q.query}" — ${q.impressions} impressions, position ${q.position.toFixed(1)}`
  );
  const ctr = (hints.ctrGapPages ?? []).map(
    (p) =>
      `- ${p.url} — ${p.impressions} impressions, ${(p.ctr * 100).toFixed(2)}% CTR, position ${p.position.toFixed(1)}`
  );
  if (!top.length && !near.length && !ctr.length) return '';

  const sections = [];
  if (top.length) sections.push(`Top-performing LinkedIn posts (last import):\n${top.join('\n')}`);
  if (near.length)
    sections.push(
      `Near-miss search queries (high impressions, ranking 20-70 — content gaps):\n${near.join('\n')}`
    );
  if (ctr.length)
    sections.push(
      `High-CTR-gap pages (rank well, lose clicks — demand proven, framing weak):\n${ctr.join('\n')}`
    );

  return `\n\nPERFORMANCE FEEDBACK
${sections.join('\n\n')}

Use this when scoring:
- Boost engagement_potential by +1 (cap 10) when the topic could capture a near-miss query above.
- Boost seo_fit by +1 (cap 10) when the topic semantically overlaps a CTR-gap page.
- Favor framings that resemble the top-performing posts (specific dollar figures, contrarian "nobody's talking about" angles, practitioner playbooks).`;
}
