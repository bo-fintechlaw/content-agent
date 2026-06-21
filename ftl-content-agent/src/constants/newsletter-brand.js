/** Segment masthead series titles (prefix before em dash theme). */
export const NEWSLETTER_SEGMENT_TITLE_PREFIX = {
  financial_services: 'The Financial Edge',
  tech_ai_legal: 'The Startup Solution',
};

export const NEWSLETTER_AUTHOR_TITLE = 'Founder & Managing Attorney';

/** Verbatim CAN-SPAM / attorney-advertising footer — must match issue_json.footer.disclaimer exactly. */
export const NEWSLETTER_FOOTER_DISCLAIMER =
  'This newsletter is provided for informational purposes only and does not constitute legal advice. ' +
  'No attorney-client relationship is formed by reading or subscribing to this newsletter. ' +
  'FinTech Law LLC is licensed to practice law in the District of Columbia, Nevada, and Ohio.';

export const NEWSLETTER_PHYSICAL_ADDRESS = 'FinTech Law LLC, Washington, DC';

export const NEWSLETTER_SUBSCRIBE_URL = 'https://fintechlaw.ai/newsletter';

/** 2026 brand refresh — email + web archive. */
export const NEWSLETTER_BRAND_COLORS = {
  black: '#0A0A0A',
  magenta: '#D41367',
  coolInk: '#525866',
  white: '#ffffff',
  surfaceAlt: '#f4f4f6',
  border: '#d8dae3',
};

/**
 * Build expected title prefix regex for a segment.
 * @param {import('../schemas/newsletter.js').NewsletterSegment} segment
 */
export function titlePrefixForSegment(segment) {
  const prefix = NEWSLETTER_SEGMENT_TITLE_PREFIX[segment];
  return new RegExp(`^${escapeRegExp(prefix)} — .+`);
}

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
