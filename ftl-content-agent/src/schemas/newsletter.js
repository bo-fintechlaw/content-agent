import { z } from 'zod';

export const NEWSLETTER_SEGMENTS = /** @type {const} */ ([
  'financial_services',
  'tech_ai_legal',
]);

export const NewsletterAuthorSchema = z.object({
  name: z.string().min(1),
  title: z.literal('Founder & Managing Attorney'),
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
  enzio_supplied: z.literal(true),
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

export const IssueJsonSchema = z.object({
  title: z.string().min(1),
  segment: z.enum(NEWSLETTER_SEGMENTS),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slug: z.string().min(1),
  author: NewsletterAuthorSchema,
  intro: z.string().min(20),
  toc: z.array(z.string().min(1)).min(1),
  panels: z.array(NewsletterPanelSchema).min(1),
  footer: NewsletterFooterSchema,
});

/**
 * @param {unknown} raw
 * @returns {z.infer<typeof IssueJsonSchema>}
 */
export function parseIssueJson(raw) {
  return IssueJsonSchema.parse(raw);
}
