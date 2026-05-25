import { z } from 'zod';

// --- Ranker output schema ---
// weighted_score is computed in code (src/pipeline/verdict.js); the schema accepts
// it for backwards compatibility but does not require it from the LLM.
export const RankerResponseSchema = z.object({
  scores: z.object({
    practice_relevance: z.number().min(0).max(10),
    timeliness: z.number().min(0).max(10),
    seo_fit: z.number().min(0).max(10),
    content_gap: z.number().min(0).max(10),
    engagement_potential: z.number().min(0).max(10),
  }),
  weighted_score: z.number().min(0).max(10).optional(),
  reasoning: z.string(),
});

// --- Drafter output schema ---
const BlogSectionSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  has_background: z.boolean().optional().default(false),
});

/**
 * Curated set of secondary lenses the drafter must pick exactly one from.
 * Each lens is an analytical frame — the drafter picks the one that best
 * surfaces the unusual angle in the source material instead of defaulting
 * every blog to a money-transmitter / ToS / privacy framing.
 *
 * Shared between the Zod schema (enum enforcement) and the drafter user
 * prompt (renders the list of choices) — single source of truth.
 */
export const LENS_LIST = /** @type {const} */ ([
  'capital formation',
  'fund formation',
  'RIA compliance',
  'broker-dealer compliance',
  'AI governance',
  'AI in legal practice',
  'AI in financial services',
  'data/model provenance',
  'consumer protection',
  'payments rail risk',
  'crypto market structure',
  'stablecoin reserves',
  'tokenization of RWAs',
  'venture/PE structuring',
  'LP-GP economics',
  'fiduciary duty',
  'cybersecurity disclosure',
  'cross-border regulatory arbitrage',
  'enforcement signal-reading',
  'rulemaking-process mechanics',
]);

const FactFromSourceSchema = z.object({
  fact: z.string().min(5),
  source_url: z.string().url(),
});

export const DrafterResponseSchema = z.object({
  angle: z.string().min(20),
  secondary_lens: z.enum(LENS_LIST),
  facts_from_source: z.array(FactFromSourceSchema).min(2).max(5),
  blog_title: z.string().min(1),
  blog_slug: z.string().min(1),
  blog_body: z.array(BlogSectionSchema).min(1),
  blog_seo_title: z.string().min(1),
  blog_seo_description: z.string().min(1),
  blog_seo_keywords: z.string().min(1),
  blog_category: z.string().min(1),
  blog_tags: z.string().min(1),
  image_prompt: z.string().optional().default(''),
  linkedin_post: z.string().min(1),
  x_post: z.string().min(1),
  x_thread: z.array(z.string()).optional().default([]),
});

// --- Judge output schema ---
const ScoreDetailSchema = z.union([
  z.number().min(0).max(10),
  z.object({
    score: z.number().min(0).max(10),
    rationale: z.string(),
  }),
]);

// composite + verdict are computed in code (src/pipeline/verdict.js); the schema
// accepts them for backwards compatibility but does not require them from the LLM.
export const JudgeResponseSchema = z.object({
  scores: z.object({
    accuracy: ScoreDetailSchema,
    engagement: ScoreDetailSchema,
    seo: ScoreDetailSchema,
    voice: ScoreDetailSchema,
    structure: ScoreDetailSchema,
    tone: ScoreDetailSchema.optional(), // backwards compat alias for voice
  }),
  composite: z.number().min(0).max(10).optional(),
  verdict: z.enum(['PASS', 'REVISE', 'REJECT']).optional(),
  revision_instructions: z.array(z.string()).optional().default([]),
  strengths: z.array(z.string()).optional().default([]),
  flags: z.array(z.string()).optional().default([]),
});

/**
 * Validate data against a Zod schema. Returns the parsed data on success.
 * Throws a descriptive Error on failure with field-level detail.
 * @param {z.ZodType} schema
 * @param {unknown} data
 * @param {string} label - e.g. 'ranker', 'drafter', 'judge'
 * @returns {any} Parsed and validated data
 */
export function validateResponse(schema, data, label) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`${label} response validation failed:\n${issues}`);
}
