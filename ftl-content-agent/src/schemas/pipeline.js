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

export const DrafterResponseSchema = z.object({
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
