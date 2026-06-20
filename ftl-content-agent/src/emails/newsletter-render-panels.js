import {
  FTL_BRAND,
  escapeHtml,
  escapeAttr,
  formatIssueDate,
  sectionLabelForKind,
} from './newsletter-brand-tokens.js';

const brand = FTL_BRAND.colors;
const fonts = FTL_BRAND.fonts;

/**
 * Render full newsletter document for email or web.
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ mode: 'email' | 'web', urls?: { archiveUrl?: string, unsubscribeUrl?: string }, meta?: { issueId?: string, status?: string, draft?: boolean } }} opts
 */
export function renderNewsletterDocument(issue, opts) {
  const { mode, urls = {}, meta = {} } = opts;
  if (mode === 'email') {
    return renderEmailDocument(issue, urls);
  }
  return renderWebDocument(issue, { urls, meta });
}

/**
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ archiveUrl?: string, unsubscribeUrl?: string }} urls
 */
export function buildNewsletterPlainText(issue, urls = {}) {
  const lines = [
    issue.title,
    formatIssueDate(issue.issue_date),
    '',
    `From ${issue.author.name}`,
    issue.intro,
    '',
    'IN THIS EDITION',
    ...issue.toc.map((t) => `- ${t}`),
    '',
  ];

  for (const panel of issue.panels) {
    lines.push(...panelToPlainText(panel));
    lines.push('');
  }

  lines.push(issue.footer.disclaimer);
  lines.push(issue.footer.physical_address);
  if (urls.archiveUrl) lines.push(`View on web: ${urls.archiveUrl}`);
  if (urls.unsubscribeUrl) lines.push(`Unsubscribe: ${urls.unsubscribeUrl}`);
  return lines.join('\n');
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number]} panel */
function panelToPlainText(panel) {
  const section = sectionLabelForKind(panel.kind);
  const lines = [`--- ${section} ---`, panel.headline, panel.dek];

  if (panel.kind === 'feature') {
    if (panel.hero_image_url) lines.push(`[Image: ${panel.hero_image_url}]`);
    for (const stat of panel.stats ?? []) {
      lines.push(`${stat.value} — ${stat.label}`);
    }
    if (panel.action_list?.length) {
      lines.push('Key takeaways:');
      for (const item of panel.action_list) lines.push(`  • ${item}`);
    }
    if (panel.pull_quote) lines.push(`Why it matters: "${panel.pull_quote}"`);
    lines.push(`Read more: ${panel.blog_url}`);
  }

  if (panel.kind === 'compliance_corner') {
    for (const d of panel.deadlines ?? []) {
      lines.push(`${d.date}: ${d.requirement}`);
    }
    for (const item of panel.litigation_watch ?? []) {
      lines.push(`• ${item}`);
    }
  }

  if (panel.kind === 'action_items') {
    for (const g of panel.groups ?? []) {
      lines.push(`${g.firm_type}:`);
      for (const item of g.items ?? []) lines.push(`  • ${item}`);
    }
    lines.push(`Schedule: ${panel.consultation_url}`);
  }

  if (panel.kind === 'spotlight') {
    lines.push(panel.body);
  }

  return lines;
}

/**
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ archiveUrl?: string, unsubscribeUrl?: string }} urls
 */
function renderEmailDocument(issue, urls) {
  const panelRows = issue.panels.map((p) => renderEmailPanel(p)).join('');
  const dateStr = formatIssueDate(issue.issue_date);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(issue.title)}</title>
</head>
<body style="margin:0;padding:0;background:${brand.surfaceAlt};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.surfaceAlt};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="${FTL_BRAND.maxWidth}" cellpadding="0" cellspacing="0" style="max-width:${FTL_BRAND.maxWidth}px;width:100%;background:${brand.white};border:1px solid ${brand.border};">
        ${emailHeaderRow(issue, dateStr)}
        ${emailIntroRow(issue)}
        ${emailTocRow(issue)}
        ${panelRows}
        ${emailFooterRow(issue, urls)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {string} dateStr */
function emailHeaderRow(issue, dateStr) {
  return `<tr><td style="padding:28px 28px 16px;background:${brand.black};border-bottom:3px solid ${brand.magenta};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="48" valign="middle" style="padding-right:12px;">
          <img src="${escapeAttr(FTL_BRAND.logoUrl)}" alt="FinTech Law" width="40" height="40" style="display:block;border-radius:8px;" />
        </td>
        <td valign="middle">
          <p style="margin:0;font:600 11px/1.4 ${fonts.ui};color:rgba(255,255,255,0.85);letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(issue.title)}</p>
          <p style="margin:4px 0 0;font:400 13px/1.4 ${fonts.ui};color:rgba(255,255,255,0.7);">${escapeHtml(dateStr)}</p>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue */
function emailIntroRow(issue) {
  return `<tr><td style="padding:28px 28px 8px;">
    <p style="margin:0 0 6px;font:600 11px/1.4 ${fonts.ui};color:${brand.magenta};letter-spacing:.08em;text-transform:uppercase;">From ${escapeHtml(issue.author.name)}</p>
    <p style="margin:0;font:400 17px/1.65 ${fonts.body};color:${brand.black};">${escapeHtml(issue.intro)}</p>
  </td></tr>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue */
function emailTocRow(issue) {
  return `<tr><td style="padding:16px 28px 8px;">
    <p style="margin:0 0 8px;font:600 11px/1.4 ${fonts.ui};color:${brand.muted};letter-spacing:.08em;text-transform:uppercase;">In This Edition</p>
    <ul style="margin:0;padding-left:20px;color:${brand.black};font:400 15px/1.6 ${fonts.body};">
      ${issue.toc.map((t) => `<li style="margin-bottom:4px;">${escapeHtml(t)}</li>`).join('')}
    </ul>
  </td></tr>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {{ archiveUrl?: string, unsubscribeUrl?: string }} urls */
function emailFooterRow(issue, urls) {
  const links = [];
  if (urls.archiveUrl) {
    links.push(`<a href="${escapeAttr(urls.archiveUrl)}" style="color:${brand.magenta};font-weight:600;">View on web</a>`);
  }
  if (urls.unsubscribeUrl) {
    links.push(`<a href="${escapeAttr(urls.unsubscribeUrl)}" style="color:${brand.magenta};font-weight:600;">Unsubscribe</a>`);
  }
  return `<tr><td style="padding:24px 28px;border-top:1px solid ${brand.border};background:${brand.surfaceAlt};">
    <p style="margin:0 0 12px;font:400 12px/1.55 ${fonts.ui};color:${brand.muted};">${escapeHtml(issue.footer.disclaimer)}</p>
    <p style="margin:0 0 12px;font:400 12px/1.5 ${fonts.ui};color:${brand.muted};">${escapeHtml(issue.footer.physical_address)}</p>
    ${links.length ? `<p style="margin:0;font:400 12px/1.5 ${fonts.ui};">${links.join(' &nbsp;·&nbsp; ')}</p>` : ''}
  </td></tr>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number]} panel */
function renderEmailPanel(panel) {
  const section = sectionLabelForKind(panel.kind);
  const kicker = panel.kicker || section;

  if (panel.kind === 'feature') return renderEmailFeature(panel, section, kicker);
  if (panel.kind === 'compliance_corner') return renderEmailCompliance(panel, section, kicker);
  if (panel.kind === 'action_items') return renderEmailActionItems(panel, section, kicker);
  if (panel.kind === 'spotlight') return renderEmailSpotlight(panel, section, kicker);
  return '';
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number] & { kind: 'feature' }} panel */
function renderEmailFeature(panel, section, kicker) {
  const hero = panel.hero_image_url
    ? `<tr><td style="padding:0 0 16px;"><img src="${escapeAttr(panel.hero_image_url)}" alt="" width="544" style="display:block;width:100%;max-width:544px;height:auto;border-radius:4px;" /></td></tr>`
    : '';

  const stats = (panel.stats ?? [])
    .map(
      (s) =>
        `<td align="center" style="padding:8px 12px;background:${brand.surfaceAlt};border:1px solid ${brand.border};">
          <p style="margin:0;font:700 22px/1.2 ${fonts.heading};color:${brand.black};">${escapeHtml(s.value)}</p>
          <p style="margin:4px 0 0;font:400 11px/1.3 ${fonts.ui};color:${brand.muted};text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(s.label)}</p>
        </td>`
    )
    .join('');
  const statsRow = stats
    ? `<tr><td style="padding:0 0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>${stats}</tr></table></td></tr>`
    : '';

  const takeaways = (panel.action_list ?? [])
    .map((item) => `<li style="margin-bottom:6px;">${escapeHtml(item)}</li>`)
    .join('');
  const takeawaysBlock = takeaways
    ? `<tr><td style="padding:0 0 16px;">
        <p style="margin:0 0 8px;font:600 11px/1.4 ${fonts.ui};color:${brand.magenta};letter-spacing:.06em;text-transform:uppercase;">Key takeaways</p>
        <ul style="margin:0;padding-left:20px;font:400 15px/1.55 ${fonts.body};color:${brand.black};">${takeaways}</ul>
      </td></tr>`
    : '';

  const callout = panel.pull_quote
    ? `<tr><td style="padding:12px 16px;background:${brand.surfaceAlt};border-left:3px solid ${brand.magenta};">
        <p style="margin:0 0 4px;font:600 10px/1.4 ${fonts.ui};color:${brand.muted};letter-spacing:.06em;text-transform:uppercase;">Why it matters</p>
        <p style="margin:0;font:400 16px/1.55 ${fonts.body};color:${brand.black};font-style:italic;">"${escapeHtml(panel.pull_quote)}"</p>
      </td></tr>`
    : '';

  return `<tr><td style="padding:24px 28px;border-top:1px solid ${brand.border};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding-bottom:12px;">
        <p style="margin:0 0 4px;font:600 10px/1.4 ${fonts.ui};color:${brand.coolInk};letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(section)}</p>
        <p style="margin:0 0 8px;font:600 11px/1.4 ${fonts.ui};color:${brand.muted};letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(kicker)}</p>
        <h2 style="margin:0 0 8px;font:700 24px/1.25 ${fonts.heading};color:${brand.black};">${escapeHtml(panel.headline)}</h2>
        <p style="margin:0;font:400 16px/1.55 ${fonts.body};color:${brand.muted};">${escapeHtml(panel.dek)}</p>
      </td></tr>
      ${hero}
      ${statsRow}
      ${takeawaysBlock}
      ${callout}
      <tr><td style="padding-top:16px;">
        <a href="${escapeAttr(panel.blog_url)}" style="display:inline-block;padding:10px 18px;background:${brand.black};color:#fff;font:600 14px/1 ${fonts.ui};text-decoration:none;border-radius:4px;">Read the full analysis →</a>
      </td></tr>
    </table>
  </td></tr>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number] & { kind: 'compliance_corner' }} panel */
function renderEmailCompliance(panel, section, kicker) {
  const deadlines = (panel.deadlines ?? [])
    .map(
      (d) =>
        `<tr>
          <td style="padding:8px 12px 8px 0;font:600 13px/1.4 ${fonts.ui};color:${brand.magenta};white-space:nowrap;vertical-align:top;">${escapeHtml(d.date)}</td>
          <td style="padding:8px 0;font:400 15px/1.5 ${fonts.body};color:${brand.black};vertical-align:top;">${escapeHtml(d.requirement)}</td>
        </tr>`
    )
    .join('');
  const deadlinesBlock = deadlines
    ? `<p style="margin:16px 0 8px;font:600 11px/1.4 ${fonts.ui};color:${brand.magenta};letter-spacing:.06em;text-transform:uppercase;">Deadlines</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${deadlines}</table>`
    : '';

  const litigation = (panel.litigation_watch ?? [])
    .map((item) => `<li style="margin-bottom:6px;">${escapeHtml(item)}</li>`)
    .join('');
  const litigationBlock = litigation
    ? `<p style="margin:16px 0 8px;font:600 11px/1.4 ${fonts.ui};color:${brand.magenta};letter-spacing:.06em;text-transform:uppercase;">Litigation watch</p>
       <ul style="margin:0;padding-left:20px;font:400 15px/1.55 ${fonts.body};color:${brand.black};">${litigation}</ul>`
    : '';

  return `<tr><td style="padding:24px 28px;border-top:1px solid ${brand.border};background:${brand.surfaceAlt};">
    <p style="margin:0 0 4px;font:600 10px/1.4 ${fonts.ui};color:${brand.coolInk};letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(section)}</p>
    <p style="margin:0 0 8px;font:600 11px/1.4 ${fonts.ui};color:${brand.muted};letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(kicker)}</p>
    <h2 style="margin:0 0 8px;font:700 22px/1.3 ${fonts.heading};color:${brand.black};">${escapeHtml(panel.headline)}</h2>
    <p style="margin:0 0 8px;font:400 16px/1.55 ${fonts.body};color:${brand.muted};">${escapeHtml(panel.dek)}</p>
    ${deadlinesBlock}
    ${litigationBlock}
  </td></tr>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number] & { kind: 'action_items' }} panel */
function renderEmailActionItems(panel, section, kicker) {
  const groups = (panel.groups ?? [])
    .map((g) => {
      const label = g.label ? `${escapeHtml(g.label)} · ` : '';
      const items = (g.items ?? []).map((item) => `<li style="margin-bottom:6px;">${escapeHtml(item)}</li>`).join('');
      return `<p style="margin:16px 0 8px;font:600 13px/1.4 ${fonts.ui};color:${brand.coolInk};">${label}${escapeHtml(g.firm_type)}</p>
              <ul style="margin:0 0 8px;padding-left:20px;font:400 15px/1.55 ${fonts.body};color:${brand.black};">${items}</ul>`;
    })
    .join('');

  return `<tr><td style="padding:24px 28px;border-top:1px solid ${brand.border};">
    <p style="margin:0 0 4px;font:600 10px/1.4 ${fonts.ui};color:${brand.coolInk};letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(section)}</p>
    <p style="margin:0 0 8px;font:600 11px/1.4 ${fonts.ui};color:${brand.muted};letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(kicker)}</p>
    <h2 style="margin:0 0 8px;font:700 22px/1.3 ${fonts.heading};color:${brand.black};">${escapeHtml(panel.headline)}</h2>
    <p style="margin:0 0 8px;font:400 16px/1.55 ${fonts.body};color:${brand.muted};">${escapeHtml(panel.dek)}</p>
    ${groups}
    <p style="margin:16px 0 0;"><a href="${escapeAttr(panel.consultation_url)}" style="color:${brand.coolInk};font:600 14px/1 ${fonts.ui};">Schedule a consultation →</a></p>
  </td></tr>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number] & { kind: 'spotlight' }} panel */
function renderEmailSpotlight(panel, section, kicker) {
  return `<tr><td style="padding:24px 28px;border-top:1px solid ${brand.border};">
    <p style="margin:0 0 4px;font:600 10px/1.4 ${fonts.ui};color:${brand.coolInk};letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(section)}</p>
    <p style="margin:0 0 8px;font:600 11px/1.4 ${fonts.ui};color:${brand.muted};letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(kicker)}</p>
    <h2 style="margin:0 0 8px;font:700 22px/1.3 ${fonts.heading};color:${brand.black};">${escapeHtml(panel.headline)}</h2>
    <p style="margin:0 0 8px;font:400 16px/1.55 ${fonts.body};color:${brand.muted};">${escapeHtml(panel.dek)}</p>
    <p style="margin:0;font:400 15px/1.6 ${fonts.body};color:${brand.black};white-space:pre-wrap;">${escapeHtml(panel.body)}</p>
  </td></tr>`;
}

/**
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ urls?: { archiveUrl?: string, unsubscribeUrl?: string }, meta?: { issueId?: string, status?: string, draft?: boolean } }} ctx
 */
function renderWebDocument(issue, ctx) {
  const { urls = {}, meta = {} } = ctx;
  const dateStr = formatIssueDate(issue.issue_date);
  const panelHtml = issue.panels.map((p) => renderWebPanel(p)).join('\n');
  const draftBanner = meta.draft
    ? `<div class="draft-banner"><strong>Draft preview</strong> — not published. Issue ${escapeHtml(meta.issueId ?? '')} · status: ${escapeHtml(meta.status ?? 'review')}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${meta.draft ? '<meta name="robots" content="noindex,nofollow" />' : ''}
  <title>${escapeHtml(issue.title)} — ${escapeHtml(dateStr)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${escapeAttr(FTL_BRAND.googleFontsHref)}" rel="stylesheet" />
  <style>${webStyles()}</style>
</head>
<body>
  <div class="wrap">
    ${draftBanner}
    <header class="masthead">
      <img class="logo" src="${escapeAttr(FTL_BRAND.logoUrl)}" alt="FinTech Law" width="48" height="48" />
      <div>
        <p class="series">${escapeHtml(issue.title)}</p>
        <p class="date">${escapeHtml(dateStr)}</p>
      </div>
    </header>
    <section class="intro">
      <p class="from-label">From ${escapeHtml(issue.author.name)}</p>
      <p class="intro-text">${escapeHtml(issue.intro)}</p>
    </section>
    <nav class="toc">
      <p class="section-label">In This Edition</p>
      <ul>${issue.toc.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
    </nav>
    ${panelHtml}
    <footer class="site-footer">
      <p>${escapeHtml(issue.footer.disclaimer)}</p>
      <p>${escapeHtml(issue.footer.physical_address)}</p>
      ${urls.archiveUrl ? `<p><a href="${escapeAttr(urls.archiveUrl)}">View archive</a></p>` : ''}
    </footer>
  </div>
</body>
</html>`;
}

function webStyles() {
  return `
    :root {
      --black: ${brand.black};
      --magenta: ${brand.magenta};
      --cool-ink: ${brand.coolInk};
      --muted: ${brand.muted};
      --surface-alt: ${brand.surfaceAlt};
      --border: ${brand.border};
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--surface-alt); color: var(--black); font-family: ${fonts.body}; line-height: 1.65; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 3rem; background: #fff; min-height: 100vh; }
    .draft-banner { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 12px 16px; border-radius: 8px; margin-bottom: 2rem; font-family: ${fonts.ui}; font-size: 0.95rem; }
    .masthead { display: flex; align-items: center; gap: 1rem; padding: 1.5rem; margin: -2rem -1.25rem 2rem; background: var(--black); border-bottom: 3px solid var(--magenta); color: #fff; }
    .logo { border-radius: 8px; }
    .series { margin: 0; font-family: ${fonts.ui}; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.9; }
    .date { margin: 0.25rem 0 0; font-family: ${fonts.ui}; font-size: 0.85rem; opacity: 0.75; }
    .intro { margin-bottom: 2rem; }
    .from-label { margin: 0 0 0.5rem; font-family: ${fonts.ui}; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--magenta); font-weight: 600; }
    .intro-text { margin: 0; font-size: 1.1rem; }
    .toc { margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
    .section-label { margin: 0 0 0.75rem; font-family: ${fonts.ui}; font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cool-ink); font-weight: 600; }
    .toc ul { margin: 0; padding-left: 1.25rem; }
    section.panel { margin-bottom: 2.5rem; padding-bottom: 2rem; border-bottom: 1px solid var(--border); }
    section.panel.compliance { background: var(--surface-alt); margin-left: -1.25rem; margin-right: -1.25rem; padding: 1.5rem 1.25rem 2rem; }
    .panel-section { margin: 0 0 0.25rem; font-family: ${fonts.ui}; font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cool-ink); font-weight: 600; }
    .kicker { margin: 0 0 0.5rem; font-family: ${fonts.ui}; font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    h2 { margin: 0 0 0.5rem; font-family: ${fonts.heading}; font-size: 1.65rem; font-weight: 400; line-height: 1.25; }
    .dek { margin: 0 0 1rem; color: var(--muted); font-size: 1.05rem; }
    .hero-img { width: 100%; height: auto; border-radius: 4px; margin-bottom: 1rem; display: block; }
    .stats { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; }
    .stat { flex: 1 1 120px; padding: 0.75rem 1rem; background: var(--surface-alt); border: 1px solid var(--border); text-align: center; }
    .stat-value { margin: 0; font-family: ${fonts.heading}; font-size: 1.5rem; color: var(--black); }
    .stat-label { margin: 0.25rem 0 0; font-family: ${fonts.ui}; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    .takeaways-label, .sub-label { margin: 1rem 0 0.5rem; font-family: ${fonts.ui}; font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--magenta); font-weight: 600; }
    .takeaways { margin: 0; padding-left: 1.25rem; }
    .callout { margin: 1rem 0; padding: 1rem 1.25rem; background: var(--surface-alt); border-left: 3px solid var(--magenta); }
    .callout-label { margin: 0 0 0.35rem; font-family: ${fonts.ui}; font-size: 0.65rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    .callout p { margin: 0; font-style: italic; }
    .cta { display: inline-block; margin-top: 1rem; padding: 0.65rem 1.1rem; background: var(--black); color: #fff; font-family: ${fonts.ui}; font-size: 0.9rem; font-weight: 600; text-decoration: none; border-radius: 4px; }
    .deadlines { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
    .deadlines td { padding: 0.5rem 0.75rem 0.5rem 0; vertical-align: top; }
    .deadline-date { font-family: ${fonts.ui}; font-weight: 600; color: var(--magenta); white-space: nowrap; }
    .action-group { margin-top: 1rem; }
    .action-group-title { margin: 0 0 0.5rem; font-family: ${fonts.ui}; font-weight: 600; color: var(--black); }
    .spotlight-body { white-space: pre-wrap; }
    .site-footer { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border); font-family: ${fonts.ui}; font-size: 0.85rem; color: var(--muted); }
    .site-footer a { color: var(--magenta); }
    a { color: var(--magenta); }
  `;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number]} panel */
function renderWebPanel(panel) {
  const section = sectionLabelForKind(panel.kind);
  const kicker = panel.kicker || section;
  const complianceClass = panel.kind === 'compliance_corner' ? ' compliance' : '';

  let inner = `
    <p class="panel-section">${escapeHtml(section)}</p>
    <p class="kicker">${escapeHtml(kicker)}</p>
    <h2>${escapeHtml(panel.headline)}</h2>
    <p class="dek">${escapeHtml(panel.dek)}</p>`;

  if (panel.kind === 'feature') {
    if (panel.hero_image_url) {
      inner += `<img class="hero-img" src="${escapeAttr(panel.hero_image_url)}" alt="" loading="lazy" />`;
    }
    if (panel.stats?.length) {
      inner += `<div class="stats">${panel.stats
        .map(
          (s) =>
            `<div class="stat"><p class="stat-value">${escapeHtml(s.value)}</p><p class="stat-label">${escapeHtml(s.label)}</p></div>`
        )
        .join('')}</div>`;
    }
    if (panel.action_list?.length) {
      inner += `<p class="takeaways-label">Key takeaways</p><ul class="takeaways">${panel.action_list.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    }
    if (panel.pull_quote) {
      inner += `<div class="callout"><p class="callout-label">Why it matters</p><p>"${escapeHtml(panel.pull_quote)}"</p></div>`;
    }
    inner += `<a class="cta" href="${escapeAttr(panel.blog_url)}">Read the full analysis →</a>`;
  }

  if (panel.kind === 'compliance_corner') {
    if (panel.deadlines?.length) {
      inner += `<p class="sub-label">Deadlines</p><table class="deadlines">${panel.deadlines
        .map(
          (d) =>
            `<tr><td class="deadline-date">${escapeHtml(d.date)}</td><td>${escapeHtml(d.requirement)}</td></tr>`
        )
        .join('')}</table>`;
    }
    if (panel.litigation_watch?.length) {
      inner += `<p class="sub-label">Litigation watch</p><ul>${panel.litigation_watch.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    }
  }

  if (panel.kind === 'action_items') {
    inner += (panel.groups ?? [])
      .map((g) => {
        const title = g.label ? `${escapeHtml(g.label)} · ${escapeHtml(g.firm_type)}` : escapeHtml(g.firm_type);
        return `<div class="action-group"><p class="action-group-title">${title}</p><ul>${(g.items ?? []).map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>`;
      })
      .join('');
    inner += `<p style="margin-top:1rem;"><a href="${escapeAttr(panel.consultation_url)}">Schedule a consultation →</a></p>`;
  }

  if (panel.kind === 'spotlight') {
    inner += `<div class="spotlight-body">${escapeHtml(panel.body)}</div>`;
  }

  return `<section class="panel${complianceClass}">${inner}</section>`;
}
