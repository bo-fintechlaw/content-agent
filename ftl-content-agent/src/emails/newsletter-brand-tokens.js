/** FinTech Law newsletter design tokens — aligned with fintechlaw.ai CSS variables. */
export const FTL_BRAND = {
  maxWidth: 600,
  logoUrl: 'https://fintechlaw.ai/apple-touch-icon.png',
  siteUrl: 'https://fintechlaw.ai',
  subscribeUrl: 'https://fintechlaw.ai/#newsletter',
  contactUrl: 'https://fintechlaw.ai/contact',
  colors: {
    black: '#191919',
    purple: '#4d539c',
    purpleDark: '#3f447c',
    pink: '#d71566',
    white: '#ffffff',
    muted: '#6f739d',
    surfaceAlt: '#ebecf2',
    border: '#cfd0de',
  },
  fonts: {
    heading: "'DM Serif Display', Georgia, 'Times New Roman', serif",
    body: "'Times New Roman', Georgia, serif",
    ui: 'Arial, Helvetica, sans-serif',
  },
};

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
