/**
 * Table-based HTML email for newsletter issues (~600px).
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ archiveUrl: string, unsubscribeUrl: string }} urls
 */
export function buildNewsletterEmailHtml(issue, urls) {
  const featureRows = issue.panels
    .filter((p) => p.kind === 'feature')
    .map(
      (p) => `
    <tr><td style="padding:24px 0;border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;font:600 11px/1.4 system-ui,sans-serif;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(p.kicker)}</p>
      <h2 style="margin:0 0 8px;font:700 22px/1.3 Georgia,serif;color:#111827;">${escapeHtml(p.headline)}</h2>
      <p style="margin:0 0 12px;font:400 16px/1.5 system-ui,sans-serif;color:#374151;">${escapeHtml(p.dek)}</p>
      <p style="margin:0;font:400 15px/1.5 Georgia,serif;color:#1f2937;font-style:italic;">"${escapeHtml(p.pull_quote)}"</p>
      <p style="margin:16px 0 0;"><a href="${escapeAttr(p.blog_url)}" style="color:#1d4ed8;font-weight:600;">Read the full analysis →</a></p>
    </td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;">
        <tr><td style="padding:32px 28px 16px;">
          <p style="margin:0 0 8px;font:600 12px/1.4 system-ui,sans-serif;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(issue.title)}</p>
          <h1 style="margin:0 0 16px;font:700 28px/1.2 Georgia,serif;color:#111827;">From Bo</h1>
          <p style="margin:0;font:400 16px/1.6 system-ui,sans-serif;color:#374151;">${escapeHtml(issue.intro)}</p>
        </td></tr>
        <tr><td style="padding:0 28px;">
          <p style="margin:0 0 8px;font:600 12px/1.4 system-ui,sans-serif;color:#6b7280;">In This Edition</p>
          <ul style="margin:0 0 8px;padding-left:20px;color:#374151;font:400 15px/1.5 system-ui,sans-serif;">
            ${issue.toc.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
          </ul>
        </td></tr>
        ${featureRows}
        <tr><td style="padding:24px 28px;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 12px;font:400 13px/1.5 system-ui,sans-serif;color:#6b7280;">${escapeHtml(issue.footer.disclaimer)}</p>
          <p style="margin:0 0 8px;font:400 12px/1.5 system-ui,sans-serif;color:#9ca3af;">${escapeHtml(issue.footer.physical_address)}</p>
          <p style="margin:0;font:400 12px/1.5 system-ui,sans-serif;">
            <a href="${escapeAttr(urls.archiveUrl)}" style="color:#1d4ed8;">View on web</a>
            · <a href="${escapeAttr(urls.unsubscribeUrl)}" style="color:#1d4ed8;">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ archiveUrl: string, unsubscribeUrl: string }} urls
 */
export function buildNewsletterEmailText(issue, urls) {
  const lines = [
    issue.title,
    '',
    issue.intro,
    '',
    'In This Edition:',
    ...issue.toc.map((t) => `- ${t}`),
    '',
  ];
  for (const p of issue.panels) {
    if (p.kind !== 'feature') continue;
    lines.push(p.headline, p.dek, p.blog_url, '');
  }
  lines.push(issue.footer.disclaimer, issue.footer.physical_address, urls.archiveUrl, urls.unsubscribeUrl);
  return lines.join('\n');
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
