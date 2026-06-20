import { z } from 'zod';

export const NEWSLETTER_SEGMENTS = /** @type {const} */ ([
  'financial_services',
  'tech_ai_legal',
]);

/** Masthead series title — "The Briefing — {theme}" */
export const BRIEFING_TITLE_RE = /^The Briefing — .+/;

export const BRIEFING_AUTHOR_TITLE = 'Managing Director & CEO';

export const NewsletterAuthorSchema = z.object({
  name: z.string().min(1),
  title: z.literal(BRIEFING_AUTHOR_TITLE),
});

export const NewsletterStatSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

const NewsletterPanelBaseSchema = z.object({
  section_no: z.number().int().positive(),
  kicker: z.string().min(1),
  headline: z.string().min(1),
  dek: z.string().min(1),
});

export const NewsletterFeaturePanelSchema = NewsletterPanelBaseSchema.extend({
  kind: z.literal('feature'),
  hero_image_url: z.string().url().optional(),
  stats: z.array(NewsletterStatSchema).max(5).default([]),
  pull_quote: z.string().min(1),
  action_list: z.array(z.string().min(1)).min(1),
  blog_url: z.string().url(),
});

export const NewsletterCompliancePanelSchema = NewsletterPanelBaseSchema.extend({
  kind: z.literal('compliance_corner'),
  deadlines: z
    .array(
      z.object({
        date: z.string().min(1),
        requirement: z.string().min(1),
      })
    )
    .default([]),
  litigation_watch: z.array(z.string().min(1)).default([]),
});

export const NewsletterActionItemsPanelSchema = NewsletterPanelBaseSchema.extend({
  kind: z.literal('action_items'),
  groups: z.array(
    z.object({
      firm_type: z.string().min(1),
      items: z.array(z.string().min(1)).min(1),
    })
  ),
  consultation_url: z.string().url(),
});

export const NewsletterSpotlightPanelSchema = NewsletterPanelBaseSchema.extend({
  kind: z.literal('spotlight'),
  body: z.string().min(1),
});

export const NewsletterPanelSchema = z.discriminatedUnion('kind', [
  NewsletterFeaturePanelSchema,
  NewsletterCompliancePanelSchema,
  NewsletterActionItemsPanelSchema,
  NewsletterSpotlightPanelSchema,
]);

export const NewsletterFooterSchema = z.object({
  disclaimer: z.string().min(20),
  subscribe_url: z.string().url(),
  physical_address: z.string().min(10),
});

export const IssueJsonSchema = z
  .object({
    title: z.string().regex(BRIEFING_TITLE_RE, 'title must match "The Briefing — {theme}"'),
    segment: z.enum(NEWSLETTER_SEGMENTS),
    issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slug: z.string().min(1),
    author: NewsletterAuthorSchema,
    intro: z.string().min(20),
    toc: z.array(z.string().min(1)).min(1),
    panels: z.array(NewsletterPanelSchema).min(1),
    footer: NewsletterFooterSchema,
  })
  .superRefine((issue, ctx) => {
    const features = issue.panels.filter((p) => p.kind === 'feature');
    if (features.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one feature panel required',
        path: ['panels'],
      });
    }
    const spotlights = issue.panels.filter((p) => p.kind === 'spotlight');
    if (spotlights.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at most one spotlight panel allowed',
        path: ['panels'],
      });
    }
  });

/**
 * @param {unknown} raw
 * @returns {z.infer<typeof IssueJsonSchema>}
 */
export function parseIssueJson(raw) {
  return IssueJsonSchema.parse(raw);
}
