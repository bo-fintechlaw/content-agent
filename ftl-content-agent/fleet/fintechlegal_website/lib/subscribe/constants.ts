export const SITE_URL = 'https://fintechlaw.ai';

export const CONSENT_TEXT =
  'By confirming, you agree to receive the selected FinTech Law newsletters at this email address.';

export const VALID_SEGMENTS = new Set(['financial_services', 'tech_ai_legal']);

export type SegmentId = 'financial_services' | 'tech_ai_legal';

export const SEGMENT_CARD: Record<
  SegmentId,
  { title: string; description: string }
> = {
  financial_services: {
    title: 'The Financial Edge',
    description: 'Financial Services regulatory intelligence',
  },
  tech_ai_legal: {
    title: 'The Startup Solution',
    description: 'Tech, AI & legal engineering for startups',
  },
};

/** @deprecated use SEGMENT_CARD[id].title */
export const SEGMENT_LABELS: Record<string, string> = {
  financial_services: SEGMENT_CARD.financial_services.title,
  tech_ai_legal: SEGMENT_CARD.tech_ai_legal.title,
};

export const FOOTER_DISCLAIMER =
  'This newsletter is provided for informational purposes only and does not constitute legal advice. ' +
  'No attorney-client relationship is formed by reading or subscribing to this newsletter. ' +
  'FinTech Law LLC is licensed to practice law in the District of Columbia, Nevada, and Ohio.';

export const PHYSICAL_ADDRESS = '6224 Turpin Hills Dr., Cincinnati, Ohio 45244';

export const TOKEN_EXPIRY_HOURS = 72;
