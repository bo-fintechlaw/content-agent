import {
  NEWSLETTER_BRAND_COLORS,
  NEWSLETTER_FOOTER_DISCLAIMER,
  NEWSLETTER_PHYSICAL_ADDRESS,
  NEWSLETTER_SUBSCRIBE_URL,
} from '../constants/newsletter-brand.js';

/** FinTech Law newsletter design tokens — 2026 brand refresh. */
export const FTL_BRAND = {
  maxWidth: 600,
  logoUrl: 'https://fintechlaw.ai/apple-touch-icon.png',
  siteUrl: 'https://fintechlaw.ai',
  subscribeUrl: NEWSLETTER_SUBSCRIBE_URL,
  contactUrl: 'https://fintechlaw.ai/contact',
  colors: {
    black: NEWSLETTER_BRAND_COLORS.black,
    magenta: NEWSLETTER_BRAND_COLORS.magenta,
    coolInk: NEWSLETTER_BRAND_COLORS.coolInk,
    white: NEWSLETTER_BRAND_COLORS.white,
    muted: NEWSLETTER_BRAND_COLORS.coolInk,
    surfaceAlt: NEWSLETTER_BRAND_COLORS.surfaceAlt,
    border: NEWSLETTER_BRAND_COLORS.border,
    /** @deprecated use black */
    purple: NEWSLETTER_BRAND_COLORS.black,
    /** @deprecated use black */
    purpleDark: '#050505',
    /** @deprecated use magenta */
    pink: NEWSLETTER_BRAND_COLORS.magenta,
  },
  fonts: {
    heading: "'Playfair Display', Georgia, 'Times New Roman', serif",
    body: "'Hanken Grotesk', Arial, Helvetica, sans-serif",
    ui: "'Hanken Grotesk', Arial, Helvetica, sans-serif",
  },
  googleFontsHref:
    'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700&family=Playfair+Display:wght@400;700&display=swap',
};

export { NEWSLETTER_FOOTER_DISCLAIMER, NEWSLETTER_PHYSICAL_ADDRESS, NEWSLETTER_SUBSCRIBE_URL };

/** @deprecated Use FTL_BRAND */
export const FTL_NEWSLETTER_BRAND = FTL_BRAND.colors;

/** @param {string} kind */
export function sectionLabelForKind(kind) {
  if (kind === 'feature') return 'FROM THE BLOG';
  if (kind === 'compliance_corner') return 'COMPLIANCE CORNER';
  if (kind === 'action_items') return 'YOUR MOVE';
  if (kind === 'spotlight') return 'SPOTLIGHT';
  return '';
}

/** @param {string} isoDate YYYY-MM-DD */
export function formatIssueDate(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** @param {string} s */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {string} s */
export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
