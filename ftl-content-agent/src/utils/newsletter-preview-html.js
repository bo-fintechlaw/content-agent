import { parseIssueJson } from '../schemas/newsletter.js';

/**
 * Temporary HTML preview for newsletter issues in review (not on fintechlaw.ai).
 * @param {unknown} issueJson
 * @param {{ issueId: string, status?: string }} meta
 */
export function buildNewsletterPreviewHtml(issueJson, meta) {
  const issue = parseIssueJson(issueJson);
  const panelHtml = issue.panels.map((panel) => renderPanel(panel)).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${esc(issue.title)} — draft preview</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 2rem auto; max-width: 720px; line-height: 1.6; padding: 0 1rem; color: #111; }
      .banner { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 12px 16px; border-radius: 8px; margin-bottom: 2rem; font-size: 0.95rem; }
      h1 { margin-bottom: 0.25rem; font-family: Georgia, serif; }
      .meta { color: #555; margin-bottom: 1.5rem; font-size: 0.9rem; }
      .intro { font-size: 1.05rem; margin-bottom: 2rem; }
      section.panel { margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid #e5e7eb; }
      .kicker { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; margin: 0 0 0.5rem; }
      h2 { font-family: Georgia, serif; margin: 0 0 0.5rem; font-size: 1.35rem; }
      .dek { color: #374151; margin: 0 0 1rem; }
      .body { white-space: pre-wrap; }
      blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid #1d4ed8; font-style: italic; color: #1f2937; }
      ul { padding-left: 1.25rem; }
      .footer { margin-top: 2rem; font-size: 0.85rem; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="banner"><strong>Draft preview</strong> — not published. The live archive at fintechlaw.ai is created only after you approve in Slack.</div>
    <h1>${esc(issue.title)}</h1>
    <div class="meta">Issue ${esc(meta.issueId)} · ${esc(issue.issue_date)} · ${esc(issue.segment)} · status: ${esc(meta.status ?? 'review')}</div>
    <p class="intro">${esc(issue.intro)}</p>
    <p><strong>In this edition:</strong></p>
    <ul>${issue.toc.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    ${panelHtml}
    <div class="footer">
      <p>${esc(issue.footer.disclaimer)}</p>
      <p>${esc(issue.footer.physical_address)}</p>
    </div>
  </body>
</html>`;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number]} panel */
function renderPanel(panel) {
  if (panel.kind === 'feature') {
    const actions = (panel.action_list ?? [])
      .map((item) => `<li>${esc(item)}</li>`)
      .join('');
    return `<section class="panel">
      <p class="kicker">${esc(panel.kicker)}</p>
      <h2>${esc(panel.headline)}</h2>
      <p class="dek">${esc(panel.dek)}</p>
      <div class="body">${esc(panel.body)}</div>
      <blockquote>${esc(panel.pull_quote)}</blockquote>
      ${actions ? `<ul>${actions}</ul>` : ''}
      <p><a href="${escAttr(panel.blog_url)}" target="_blank" rel="noopener">Read the full blog post →</a></p>
    </section>`;
  }
  if (panel.kind === 'compliance_corner') {
    return `<section class="panel">
      <p class="kicker">${esc(panel.kicker)}</p>
      <h2>${esc(panel.headline)}</h2>
      <p class="dek">${esc(panel.dek)}</p>
      <div class="body">${esc(panel.body)}</div>
    </section>`;
  }
  if (panel.kind === 'action_items') {
    const groups = (panel.groups ?? [])
      .map(
        (g) =>
          `<h3>${esc(g.label)} (${esc(g.firm_type)})</h3><ul>${(g.items ?? [])
            .map((item) => `<li>${esc(item)}</li>`)
            .join('')}</ul>`
      )
      .join('');
    return `<section class="panel">
      <p class="kicker">${esc(panel.kicker)}</p>
      <h2>${esc(panel.headline)}</h2>
      <p class="dek">${esc(panel.dek)}</p>
      ${groups}
      <p><a href="${escAttr(panel.consultation_url)}">Schedule a consultation →</a></p>
    </section>`;
  }
  return '';
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escAttr(value) {
  return esc(value).replaceAll("'", '&#39;');
}
