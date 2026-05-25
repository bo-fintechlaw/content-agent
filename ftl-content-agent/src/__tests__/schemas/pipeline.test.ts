import { describe, expect, it } from '@jest/globals';

const {
  RankerResponseSchema,
  DrafterResponseSchema,
  JudgeResponseSchema,
  LENS_LIST,
  validateResponse,
} = await import('../../schemas/pipeline.js');

// --- Ranker Schema ---
describe('RankerResponseSchema', () => {
  const validRanker = {
    scores: {
      practice_relevance: 8,
      timeliness: 7,
      seo_fit: 6.5,
      content_gap: 5,
      engagement_potential: 9,
    },
    weighted_score: 7.2,
    reasoning: 'Highly relevant regulatory enforcement topic',
  };

  it('accepts a valid ranker response', () => {
    const result = RankerResponseSchema.safeParse(validRanker);
    expect(result.success).toBe(true);
  });

  it('accepts missing weighted_score (computed in code per verdict.js)', () => {
    const { weighted_score, ...withoutWeighted } = validRanker;
    const result = RankerResponseSchema.safeParse(withoutWeighted);
    expect(result.success).toBe(true);
  });

  it('rejects scores out of range (> 10)', () => {
    const bad = { ...validRanker, scores: { ...validRanker.scores, timeliness: 11 } };
    const result = RankerResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects scores out of range (< 0)', () => {
    const bad = { ...validRanker, scores: { ...validRanker.scores, seo_fit: -1 } };
    const result = RankerResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects missing score dimensions', () => {
    const { practice_relevance, ...partial } = validRanker.scores;
    const bad = { ...validRanker, scores: partial };
    const result = RankerResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric weighted_score', () => {
    const bad = { ...validRanker, weighted_score: 'high' };
    const result = RankerResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// --- Drafter Schema ---
describe('DrafterResponseSchema', () => {
  const validDrafter = {
    angle:
      'The SEC settlement targets boilerplate hedge clause language found in roughly 40% of mid-size advisory agreements.',
    secondary_lens: 'RIA compliance',
    facts_from_source: [
      {
        fact: '$150,000 in combined penalties against FamilyWealth Advisory Group',
        source_url: 'https://www.sec.gov/litigation/admin/2026/ia-1234.pdf',
      },
      {
        fact: 'Settlement announced January 2026',
        source_url: 'https://www.sec.gov/news/press-release/2026-1',
      },
    ],
    blog_title: 'SEC Issues $150K Wake-Up Call: Advisory Agreement Lessons',
    blog_slug: 'sec-advisory-agreement-lessons',
    blog_body: [
      { title: 'The Enforcement Action', body: 'Content here with details.', has_background: false },
      { title: 'Key Takeaways', body: 'More analysis here.', has_background: true },
    ],
    blog_seo_title: 'SEC Advisory Agreement Enforcement',
    blog_seo_description: 'What the FamilyWealth settlement means for your advisory agreements.',
    blog_seo_keywords: 'SEC enforcement, advisory agreement, hedge clause',
    blog_category: 'regulatory',
    blog_tags: 'sec, enforcement, advisory',
    image_prompt: 'Legal gavel on financial documents, editorial illustration',
    linkedin_post: 'The SEC just sent a clear message to every investment adviser.',
    x_post: 'SEC fines advisory firm $150K for boilerplate hedge clauses.',
    x_thread: ['Thread tweet 1', 'Thread tweet 2', 'Thread tweet 3'],
  };

  it('accepts a valid drafter response', () => {
    const result = DrafterResponseSchema.safeParse(validDrafter);
    expect(result.success).toBe(true);
  });

  it('rejects empty blog_body array', () => {
    const bad = { ...validDrafter, blog_body: [] };
    const result = DrafterResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects blog_body sections with empty title', () => {
    const bad = { ...validDrafter, blog_body: [{ title: '', body: 'content', has_background: false }] };
    const result = DrafterResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects blog_body sections with empty body', () => {
    const bad = { ...validDrafter, blog_body: [{ title: 'Title', body: '', has_background: false }] };
    const result = DrafterResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects missing required string fields', () => {
    const { blog_title, ...incomplete } = validDrafter;
    const result = DrafterResponseSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('defaults x_thread to empty array when missing', () => {
    const { x_thread, ...noThread } = validDrafter;
    const result = DrafterResponseSchema.safeParse(noThread);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.x_thread).toEqual([]);
    }
  });

  it('defaults image_prompt to empty string when missing', () => {
    const { image_prompt, ...noImage } = validDrafter;
    const result = DrafterResponseSchema.safeParse(noImage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.image_prompt).toBe('');
    }
  });

  it('defaults has_background to false when missing', () => {
    const noBackground = {
      ...validDrafter,
      blog_body: [{ title: 'Section', body: 'Content here.' }],
    };
    const result = DrafterResponseSchema.safeParse(noBackground);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blog_body[0].has_background).toBe(false);
    }
  });

  it('rejects missing angle', () => {
    const { angle, ...noAngle } = validDrafter;
    const result = DrafterResponseSchema.safeParse(noAngle);
    expect(result.success).toBe(false);
  });

  it('rejects angle shorter than 20 chars', () => {
    const bad = { ...validDrafter, angle: 'too short' };
    const result = DrafterResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects secondary_lens not in the curated LENS_LIST', () => {
    const bad = { ...validDrafter, secondary_lens: 'made-up lens' };
    const result = DrafterResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts every value in LENS_LIST as a valid secondary_lens', () => {
    for (const lens of LENS_LIST) {
      const ok = { ...validDrafter, secondary_lens: lens };
      const result = DrafterResponseSchema.safeParse(ok);
      expect(result.success).toBe(true);
    }
  });

  it('rejects facts_from_source with fewer than 2 entries', () => {
    const bad = {
      ...validDrafter,
      facts_from_source: [validDrafter.facts_from_source[0]],
    };
    const result = DrafterResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects facts_from_source entries with non-URL source_url', () => {
    const bad = {
      ...validDrafter,
      facts_from_source: [
        { fact: 'Some fact here', source_url: 'not a url' },
        { fact: 'Another fact', source_url: 'https://valid.example.com' },
      ],
    };
    const result = DrafterResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// --- Judge Schema ---
describe('JudgeResponseSchema', () => {
  const validJudge = {
    scores: {
      accuracy: { score: 8, rationale: 'Citations verified' },
      engagement: { score: 7, rationale: 'Strong opening' },
      seo: { score: 9, rationale: 'Keywords well placed' },
      voice: { score: 8, rationale: 'Matches Bo voice' },
      structure: { score: 7, rationale: 'Follows blueprint' },
    },
    composite: 7.8,
    verdict: 'PASS',
    revision_instructions: [],
    strengths: ['Strong regulatory analysis'],
    flags: [],
  };

  it('accepts a valid judge response', () => {
    const result = JudgeResponseSchema.safeParse(validJudge);
    expect(result.success).toBe(true);
  });

  it('accepts numeric scores (backwards compat)', () => {
    const numericScores = {
      ...validJudge,
      scores: { accuracy: 8, engagement: 7, seo: 9, voice: 8, structure: 7 },
    };
    const result = JudgeResponseSchema.safeParse(numericScores);
    expect(result.success).toBe(true);
  });

  it('accepts tone as alias for voice', () => {
    const withTone = {
      ...validJudge,
      scores: { ...validJudge.scores, tone: { score: 7, rationale: 'OK' } },
    };
    const result = JudgeResponseSchema.safeParse(withTone);
    expect(result.success).toBe(true);
  });

  it('rejects invalid verdict', () => {
    const bad = { ...validJudge, verdict: 'MAYBE' };
    const result = JudgeResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts response without composite or verdict (computed in code per verdict.js)', () => {
    const { composite, verdict, ...withoutComputed } = validJudge;
    const result = JudgeResponseSchema.safeParse(withoutComputed);
    expect(result.success).toBe(true);
  });

  it('rejects missing scores object', () => {
    const { scores, ...noScores } = validJudge;
    const result = JudgeResponseSchema.safeParse(noScores);
    expect(result.success).toBe(false);
  });

  it('rejects scores out of range', () => {
    const bad = {
      ...validJudge,
      scores: { ...validJudge.scores, accuracy: { score: 12, rationale: 'Off scale' } },
    };
    const result = JudgeResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('defaults optional arrays when missing', () => {
    const { revision_instructions, strengths, flags, ...minimal } = validJudge;
    const result = JudgeResponseSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.revision_instructions).toEqual([]);
      expect(result.data.strengths).toEqual([]);
      expect(result.data.flags).toEqual([]);
    }
  });
});

// --- validateResponse helper ---
describe('validateResponse', () => {
  it('returns parsed data on success', () => {
    const data = {
      scores: { practice_relevance: 5, timeliness: 5, seo_fit: 5, content_gap: 5, engagement_potential: 5 },
      weighted_score: 5,
      reasoning: 'Average',
    };
    const result = validateResponse(RankerResponseSchema, data, 'ranker');
    expect(result.weighted_score).toBe(5);
  });

  it('throws descriptive error on failure', () => {
    expect(() => validateResponse(RankerResponseSchema, {}, 'ranker')).toThrow(
      'ranker response validation failed'
    );
  });

  it('includes field paths in error message', () => {
    try {
      validateResponse(RankerResponseSchema, { scores: {}, weighted_score: 'x', reasoning: '' }, 'ranker');
    } catch (e: any) {
      expect(e.message).toContain('ranker response validation failed');
    }
  });
});
