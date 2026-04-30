/**
 * Single source of truth for ranker + judge weighted-score math and verdict thresholds.
 *
 * Phase 1 of FTL_Prompt_Architecture_Proposal_v1: composite arithmetic and verdict
 * derivation are computed in code, not by the LLM. The LLM returns per-criterion scores;
 * code computes the rest.
 */

// ── Ranker ───────────────────────────────────────────────────────

export const RANKER_WEIGHTS = Object.freeze({
  practice_relevance: 0.30,
  timeliness: 0.25,
  seo_fit: 0.20,
  content_gap: 0.15,
  engagement_potential: 0.10,
});

/**
 * @param {Record<string, number>} scores
 * @returns {number} weighted score, clamped 0-10, rounded to 1 decimal
 */
export function computeRankerWeightedScore(scores) {
  const s = scores ?? {};
  let total = 0;
  for (const [key, weight] of Object.entries(RANKER_WEIGHTS)) {
    const v = Number(s[key]);
    if (!Number.isFinite(v)) {
      throw new Error(`ranker score "${key}" is not numeric (got ${s[key]})`);
    }
    total += v * weight;
  }
  const clamped = Math.max(0, Math.min(10, total));
  return Number(clamped.toFixed(1));
}

// ── Judge ────────────────────────────────────────────────────────

export const JUDGE_WEIGHTS = Object.freeze({
  accuracy: 1.5,
  engagement: 1.0,
  seo: 0.75,
  voice: 1.25,
  structure: 1.0,
});

const JUDGE_WEIGHT_SUM = Object.values(JUDGE_WEIGHTS).reduce((a, b) => a + b, 0); // 5.5

export const JUDGE_VERDICT_THRESHOLDS = Object.freeze({
  PASS_COMPOSITE: 8.0,
  PASS_MIN_INDIVIDUAL: 6,
  REJECT_COMPOSITE: 5.0,
  REJECT_ACCURACY: 5,
});

/**
 * Normalize a single judge score field that may be a number, an object {score, rationale},
 * or missing. `tone` is a legacy alias for `voice`.
 */
export function normalizeJudgeScores(rawScores) {
  const pick = (v) => {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    const n = Number(v.score ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const raw = rawScores ?? {};
  return {
    accuracy: pick(raw.accuracy),
    engagement: pick(raw.engagement),
    seo: pick(raw.seo),
    voice: pick(raw.voice ?? raw.tone),
    structure: pick(raw.structure),
  };
}

/**
 * @param {Record<string, number>} normalizedScores - output of normalizeJudgeScores
 * @returns {number} composite score, 0-10, rounded to 1 decimal
 */
export function computeJudgeComposite(normalizedScores) {
  let total = 0;
  for (const [key, weight] of Object.entries(JUDGE_WEIGHTS)) {
    total += Number(normalizedScores[key] ?? 0) * weight;
  }
  const composite = total / JUDGE_WEIGHT_SUM;
  const clamped = Math.max(0, Math.min(10, composite));
  return Number(clamped.toFixed(1));
}

/**
 * Derive verdict from composite + per-criterion scores.
 * Single source of truth — the judge prompt no longer states verdict logic.
 *
 * @param {{ composite: number, scores: Record<string, number> }} input
 * @returns {'PASS' | 'REVISE' | 'REJECT'}
 */
export function deriveJudgeVerdict({ composite, scores }) {
  const t = JUDGE_VERDICT_THRESHOLDS;
  const accuracy = Number(scores?.accuracy ?? 0);

  if (composite < t.REJECT_COMPOSITE || accuracy < t.REJECT_ACCURACY) {
    return 'REJECT';
  }

  const allAtOrAboveMin = ['accuracy', 'engagement', 'seo', 'voice', 'structure'].every(
    (k) => Number(scores?.[k] ?? 0) >= t.PASS_MIN_INDIVIDUAL
  );
  if (composite >= t.PASS_COMPOSITE && allAtOrAboveMin) {
    return 'PASS';
  }

  return 'REVISE';
}
