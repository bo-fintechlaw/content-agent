import { describe, expect, it } from '@jest/globals';

const {
  RANKER_WEIGHTS,
  JUDGE_WEIGHTS,
  JUDGE_VERDICT_THRESHOLDS,
  computeRankerWeightedScore,
  normalizeJudgeScores,
  computeJudgeComposite,
  deriveJudgeVerdict,
} = await import('../../pipeline/verdict.js');

describe('RANKER_WEIGHTS', () => {
  it('weights sum to 1.0', () => {
    const sum = (Object.values(RANKER_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
});

describe('computeRankerWeightedScore', () => {
  it('matches anchor Example A from ranker prompt (~9.0)', () => {
    const score = computeRankerWeightedScore({
      practice_relevance: 10,
      timeliness: 9,
      seo_fit: 9,
      content_gap: 8,
      engagement_potential: 9,
    });
    // 0.30*10 + 0.25*9 + 0.20*9 + 0.15*8 + 0.10*9 = 3 + 2.25 + 1.8 + 1.2 + 0.9 = 9.15 → 9.2
    expect(score).toBe(9.2);
  });

  it('matches the integration-test expected value of 7.8', () => {
    const score = computeRankerWeightedScore({
      practice_relevance: 9,
      timeliness: 8,
      seo_fit: 7,
      content_gap: 6,
      engagement_potential: 8,
    });
    expect(score).toBe(7.8);
  });

  it('low-end anchor C lands near 3', () => {
    const score = computeRankerWeightedScore({
      practice_relevance: 2,
      timeliness: 8,
      seo_fit: 1,
      content_gap: 2,
      engagement_potential: 3,
    });
    // 0.30*2 + 0.25*8 + 0.20*1 + 0.15*2 + 0.10*3 = 0.6 + 2.0 + 0.2 + 0.3 + 0.3 = 3.4
    expect(score).toBe(3.4);
  });

  it('clamps to [0, 10]', () => {
    expect(
      computeRankerWeightedScore({
        practice_relevance: 0,
        timeliness: 0,
        seo_fit: 0,
        content_gap: 0,
        engagement_potential: 0,
      })
    ).toBe(0);
    expect(
      computeRankerWeightedScore({
        practice_relevance: 10,
        timeliness: 10,
        seo_fit: 10,
        content_gap: 10,
        engagement_potential: 10,
      })
    ).toBe(10);
  });

  it('throws on non-numeric score input', () => {
    expect(() =>
      computeRankerWeightedScore({
        practice_relevance: 5,
        timeliness: 5,
        seo_fit: 5,
        content_gap: 5,
        engagement_potential: 'high' as any,
      })
    ).toThrow('engagement_potential');
  });
});

describe('JUDGE_WEIGHTS', () => {
  it('weights sum to 5.5 (the divisor used for composite)', () => {
    const sum = (Object.values(JUDGE_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(5.5, 6);
  });
});

describe('normalizeJudgeScores', () => {
  it('passes through numeric scores unchanged', () => {
    const out = normalizeJudgeScores({
      accuracy: 8,
      engagement: 7,
      seo: 6,
      voice: 9,
      structure: 7,
    });
    expect(out).toEqual({ accuracy: 8, engagement: 7, seo: 6, voice: 9, structure: 7 });
  });

  it('extracts .score from {score, rationale} object format', () => {
    const out = normalizeJudgeScores({
      accuracy: { score: 8, rationale: 'good' },
      engagement: { score: 6, rationale: 'meh' },
      seo: { score: 7, rationale: 'ok' },
      voice: { score: 9, rationale: 'great' },
      structure: { score: 8, rationale: 'fine' },
    });
    expect(out.accuracy).toBe(8);
    expect(out.voice).toBe(9);
  });

  it('uses tone as alias for voice when voice is missing', () => {
    const out = normalizeJudgeScores({
      accuracy: 7,
      engagement: 7,
      seo: 7,
      tone: { score: 8, rationale: 'tone match' },
      structure: 7,
    });
    expect(out.voice).toBe(8);
  });

  it('defaults missing fields to 0', () => {
    const out = normalizeJudgeScores({});
    expect(out).toEqual({ accuracy: 0, engagement: 0, seo: 0, voice: 0, structure: 0 });
  });
});

describe('computeJudgeComposite', () => {
  it('happy-path PASS scores compute to 8.5', () => {
    const composite = computeJudgeComposite({
      accuracy: 9,
      engagement: 8,
      seo: 8,
      voice: 9,
      structure: 8,
    });
    // (9*1.5 + 8*1.0 + 8*0.75 + 9*1.25 + 8*1.0) / 5.5 = 46.75 / 5.5 = 8.5
    expect(composite).toBe(8.5);
  });

  it('mid-range REVISE scores compute below 8.0', () => {
    const composite = computeJudgeComposite({
      accuracy: 7,
      engagement: 5,
      seo: 6,
      voice: 6,
      structure: 7,
    });
    // (10.5 + 5 + 4.5 + 7.5 + 7) / 5.5 = 34.5 / 5.5 = 6.27 → 6.3
    expect(composite).toBe(6.3);
  });

  it('clamps to [0, 10]', () => {
    expect(
      computeJudgeComposite({ accuracy: 0, engagement: 0, seo: 0, voice: 0, structure: 0 })
    ).toBe(0);
    expect(
      computeJudgeComposite({ accuracy: 10, engagement: 10, seo: 10, voice: 10, structure: 10 })
    ).toBe(10);
  });
});

describe('deriveJudgeVerdict', () => {
  it('returns PASS when composite >= 8.0 and all individual >= 6', () => {
    expect(
      deriveJudgeVerdict({
        composite: 8.5,
        scores: { accuracy: 9, engagement: 8, seo: 8, voice: 9, structure: 8 },
      })
    ).toBe('PASS');
  });

  it('returns PASS at exact threshold 8.0', () => {
    expect(
      deriveJudgeVerdict({
        composite: 8.0,
        scores: { accuracy: 8, engagement: 8, seo: 8, voice: 8, structure: 8 },
      })
    ).toBe('PASS');
  });

  it('returns REVISE when composite is below 8.0 even if all scores >= 6', () => {
    expect(
      deriveJudgeVerdict({
        composite: 6.5,
        scores: { accuracy: 7, engagement: 6, seo: 6, voice: 6, structure: 7 },
      })
    ).toBe('REVISE');
  });

  it('returns REVISE when composite >= 8.0 but at least one individual < 6', () => {
    expect(
      deriveJudgeVerdict({
        composite: 8.1,
        scores: { accuracy: 9, engagement: 5, seo: 9, voice: 9, structure: 9 },
      })
    ).toBe('REVISE');
  });

  it('returns REJECT when composite < 5.0', () => {
    expect(
      deriveJudgeVerdict({
        composite: 4.9,
        scores: { accuracy: 6, engagement: 4, seo: 4, voice: 5, structure: 5 },
      })
    ).toBe('REJECT');
  });

  it('returns REJECT when accuracy < 5 regardless of composite', () => {
    expect(
      deriveJudgeVerdict({
        composite: 7.0,
        scores: { accuracy: 4, engagement: 8, seo: 8, voice: 8, structure: 8 },
      })
    ).toBe('REJECT');
  });

  it('returns REVISE at the boundary composite = 5.0 with accuracy >= 5', () => {
    expect(
      deriveJudgeVerdict({
        composite: 5.0,
        scores: { accuracy: 5, engagement: 5, seo: 5, voice: 5, structure: 5 },
      })
    ).toBe('REVISE');
  });
});

describe('JUDGE_VERDICT_THRESHOLDS', () => {
  it('exposes the canonical thresholds', () => {
    expect(JUDGE_VERDICT_THRESHOLDS.PASS_COMPOSITE).toBe(8.0);
    expect(JUDGE_VERDICT_THRESHOLDS.PASS_MIN_INDIVIDUAL).toBe(6);
    expect(JUDGE_VERDICT_THRESHOLDS.REJECT_COMPOSITE).toBe(5.0);
    expect(JUDGE_VERDICT_THRESHOLDS.REJECT_ACCURACY).toBe(5);
  });
});
