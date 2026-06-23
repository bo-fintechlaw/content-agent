import {
  CONSENT_TEXT,
  FOOTER_DISCLAIMER,
  PHYSICAL_ADDRESS,
  SEGMENT_CARD,
  type SegmentId,
} from './constants.js';

const BRAND = {
  black: '#0A0A0A',
  magenta: '#D41367',
  coolInk: '#525866',
  white: '#ffffff',
  surfaceAlt: '#f4f4f6',
  border: '#d8dae3',
  maxWidth: 600,
  fonts: {
    heading: "'Playfair Display', Georgia, 'Times New Roman', serif",
    body: "'Hanken Grotesk', Arial, Helvetica, sans-serif",
    ui: "'Hanken Grotesk', Arial, Helvetica, sans-serif",
  },
};

function escapeHtml(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function normalizeSegments(segments?: string[]): SegmentId[] {
  const valid: SegmentId[] = ['financial_services', 'tech_ai_legal'];
  const input = Array.isArray(segments) ? segments : [];
  const out = valid.filter((s) => input.includes(s));
  return out.length ? out : valid;
}

function resolveCopy(segments: SegmentId[], mode: 'initial' | 'repermission') {
  const titles = segments.map((s) => SEGMENT_CARD[s].title);
  const isRepermission = mode === 'repermission';
  const both = segments.length === 2;
  const seriesSubtitle = both ? titles.join(' & ') : titles[0];

  if (both) {
    return {
      seriesSubtitle,
      subject: isRepermission
        ? `Confirm you’d like to keep receiving ${titles[0]} and ${titles[1]}`
        : 'Confirm your FinTech Law newsletter subscriptions',
      headline: isRepermission ? 'One quick step to stay on our lists' : 'Confirm your subscription',
      intro: isRepermission
        ? 'You previously subscribed to FinTech Law newsletters. We’ve moved to a new email platform and need your confirmation to keep sending you the editions below.'
        : 'Thanks for subscribing to FinTech Law newsletters. Please confirm your email address to start receiving the editions below.',
      ctaLabel: isRepermission ? 'Yes, keep me subscribed' : 'Confirm subscription',
    };
  }

  const segment = segments[0];
  const card = SEGMENT_CARD[segment];

  return {
    seriesSubtitle,
    subject: isRepermission
      ? `Confirm you’d like to keep receiving ${card.title}`
      : `Confirm your ${card.title} subscription`,
    headline: isRepermission ? 'One quick step to stay on our list' : 'Confirm your subscription',
    intro: isRepermission
      ? `You previously subscribed to ${card.title}. We’ve moved to a new email platform and need your confirmation to keep sending you ${card.description.toLowerCase()}.`
      : `Thanks for your interest in ${card.title}. Please confirm your email address to complete your subscription.`,
    ctaLabel: isRepermission ? 'Yes, keep me subscribed' : 'Confirm subscription',
  };
}

function renderSegmentCards(segments: SegmentId[]) {
  return segments
    .map((segment) => {
      const card = SEGMENT_CARD[segment];
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid ${BRAND.border};border-radius:6px;background:${BRAND.white};">
        <tr><td style="padding:16px 18px;border-left:4px solid ${BRAND.magenta};">
          <p style="margin:0 0 6px;font:700 16px/1.35 ${BRAND.fonts.heading};color:${BRAND.black};">${escapeHtml(card.title)}</p>
          <p style="margin:0;font:400 14px/1.55 ${BRAND.fonts.body};color:${BRAND.coolInk};">${escapeHtml(card.description)}</p>
        </td></tr>
      </table>`;
    })
    .join('');
}

function renderBrandMark(logoUrl?: string) {
  const url = String(logoUrl ?? '').trim();
  if (url) {
    return `<img src="${escapeAttr(url)}" alt="FinTech Law" width="40" height="40" style="display:block;border-radius:8px;" />`;
  }
  return `<p style="margin:0;font:700 22px/1.1 ${BRAND.fonts.heading};letter-spacing:-0.02em;">
    <span style="color:${BRAND.magenta};">FinTech</span><span style="color:${BRAND.white};"> Law</span>
  </p>`;
}

export function buildSubscribeConfirmEmail({
  confirmUrl,
  mode = 'initial',
  segments,
  consentText = CONSENT_TEXT,
  logoUrl = '',
}: {
  confirmUrl: string;
  mode?: 'initial' | 'repermission';
  segments?: string[];
  consentText?: string;
  logoUrl?: string;
}) {
  const normalized = normalizeSegments(segments);
  const copy = resolveCopy(normalized, mode);
  const segmentCards = renderSegmentCards(normalized);
  const brandMark = renderBrandMark(logoUrl);
  const consent = String(consentText ?? '').trim();
  const secondary =
    mode === 'repermission'
      ? 'If you no longer wish to receive these emails, you can ignore this message — we will not add you to our new list without your confirmation.'
      : 'If you did not request this, you can safely ignore this email.';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.surfaceAlt};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surfaceAlt};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="${BRAND.maxWidth}" cellpadding="0" cellspacing="0" style="max-width:${BRAND.maxWidth}px;width:100%;background:${BRAND.white};border:1px solid ${BRAND.border};">
        <tr><td style="padding:28px 28px 20px;background:${BRAND.black};border-bottom:3px solid ${BRAND.magenta};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="48" valign="middle" style="padding-right:12px;">
                ${brandMark}
              </td>
              <td valign="middle">
                <p style="margin:0;font:600 11px/1.4 ${BRAND.fonts.ui};color:rgba(255,255,255,0.85);letter-spacing:.1em;text-transform:uppercase;">FinTech Law Newsletter</p>
                <p style="margin:4px 0 0;font:400 13px/1.4 ${BRAND.fonts.ui};color:rgba(255,255,255,0.7);">${escapeHtml(copy.seriesSubtitle)}</p>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:32px 28px 8px;">
          <h1 style="margin:0 0 16px;font:700 26px/1.25 ${BRAND.fonts.heading};color:${BRAND.black};">${escapeHtml(copy.headline)}</h1>
          <p style="margin:0 0 20px;font:400 17px/1.65 ${BRAND.fonts.body};color:${BRAND.black};">${escapeHtml(copy.intro)}</p>
          ${segmentCards}
          ${consent ? `<p style="margin:16px 0 20px;font:400 13px/1.6 ${BRAND.fonts.ui};color:${BRAND.coolInk};">${escapeHtml(consent)}</p>` : ''}
          <p style="margin:0 0 28px;font:400 15px/1.6 ${BRAND.fonts.body};color:${BRAND.coolInk};">${escapeHtml(secondary)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td style="border-radius:4px;background:${BRAND.magenta};">
              <a href="${escapeAttr(confirmUrl)}" style="display:inline-block;padding:14px 28px;font:700 15px/1 ${BRAND.fonts.ui};color:${BRAND.white};text-decoration:none;letter-spacing:.02em;">${escapeHtml(copy.ctaLabel)}</a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font:400 13px/1.55 ${BRAND.fonts.ui};color:${BRAND.coolInk};">
            Button not working? Copy and paste this link into your browser:<br>
            <a href="${escapeAttr(confirmUrl)}" style="color:${BRAND.magenta};word-break:break-all;">${escapeHtml(confirmUrl)}</a>
          </p>
        </td></tr>
        <tr><td style="padding:24px 28px;border-top:1px solid ${BRAND.border};background:${BRAND.surfaceAlt};">
          <p style="margin:0 0 12px;font:400 12px/1.55 ${BRAND.fonts.ui};color:${BRAND.coolInk};">${escapeHtml(FOOTER_DISCLAIMER)}</p>
          <p style="margin:0;font:400 12px/1.5 ${BRAND.fonts.ui};color:${BRAND.coolInk};">${escapeHtml(PHYSICAL_ADDRESS)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    copy.headline,
    '',
    copy.intro,
    '',
    ...normalized.flatMap((segment) => {
      const card = SEGMENT_CARD[segment];
      return [`${card.title} — ${card.description}`, ''];
    }),
  ];
  if (consent) textLines.push(consent, '');
  textLines.push(
    secondary,
    '',
    `${copy.ctaLabel}: ${confirmUrl}`,
    '',
    FOOTER_DISCLAIMER,
    PHYSICAL_ADDRESS
  );

  return { subject: copy.subject, html, text: textLines.join('\n') };
}

/** Alias for content-agent parity */
export const renderSubscribeConfirmEmail = buildSubscribeConfirmEmail;
