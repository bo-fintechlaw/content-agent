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

/** CAN-SPAM physical mailing address — included in email footer only (not web archive). */
export const NEWSLETTER_PHYSICAL_ADDRESS = '6224 Turpin Hills Dr., Cincinnati, Ohio 45244';

export const NEWSLETTER_SUBSCRIBE_URL = 'https://fintechlaw.ai/newsletter';

export const NEWSLETTER_SHARE_URL = NEWSLETTER_SUBSCRIBE_URL;

export const NEWSLETTER_SHARE_CTA = 'Know someone who should read this? Share the newsletter.';

export const NEWSLETTER_CONTACT_URL = 'https://fintechlaw.ai/contact';

export const NEWSLETTER_CONTACT_CTA = 'Questions about your compliance posture? Contact our team.';

export const NEWSLETTER_UNSUBSCRIBE_URL = 'https://fintechlaw.ai/unsubscribe';

/** Keep this many published Sanity archive pages per segment (biweekly cadence ≈ 2 months). */
export const NEWSLETTER_ARCHIVE_RETENTION_COUNT = 4;

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
