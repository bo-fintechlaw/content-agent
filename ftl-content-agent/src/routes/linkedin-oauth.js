import { fail, start, success } from '../utils/logger.js';

/**
 * Dev-only: LinkedIn redirects here after authorization so you can read `code` without a dead page.
 * The redirect URI must match **exactly** what is in your LinkedIn app (Authorized redirect URLs)
 * and what you use in the token exchange (including http vs https).
 */
/**
 * @param {import('express').Application} app
 * @param {{ LINKEDIN_CLIENT_ID: string, LINKEDIN_REDIRECT_URI: string, PORT: number }} config
 */
export function registerLinkedInOAuthDevCallback(app, config) {
  app.get('/oauth/linkedin/start', (_req, res) => {
    start('GET /oauth/linkedin/start');
    const clientId = config.LINKEDIN_CLIENT_ID;
    const redirectUri =
      config.LINKEDIN_REDIRECT_URI ||
      `http://localhost:${config.PORT}/callback/linkedin`;
    const scope = 'openid profile email w_member_social';
    const state = 'ftlcontent';
    const url =
      'https://www.linkedin.com/oauth/v2/authorization' +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${encodeURIComponent(state)}`;
    let host = '';
    try {
      host = new URL(redirectUri).host;
    } catch {
      /* ignore */
    }
    success('GET /oauth/linkedin/start', { redirectUriHost: host || redirectUri });
    res.redirect(302, url);
  });

  const handler = (req, res) => {
    start('GET /callback/linkedin', { originalUrl: req.originalUrl, query: req.query });

    const { code, state, error, error_description } = req.query;

    if (error) {
      fail(
        'GET /callback/linkedin',
        new Error(String(error)),
        { error_description: error_description ?? '' }
      );
      return res.status(400).type('html').send(
        page({
          title: 'LinkedIn OAuth error',
          body: `<p><strong>${escapeHtml(String(error))}</strong></p><p>${escapeHtml(String(error_description ?? ''))}</p>
<p>Fix the issue on LinkedIn (scopes, redirect URL, app approval), then start authorization again from the LinkedIn authorize URL — do not open this callback URL directly.</p>`,
        })
      );
    }

    if (!code) {
      fail('GET /callback/linkedin', new Error('missing_code'), {
        queryKeys: Object.keys(req.query),
      });
      return res.status(400).type('html').send(
        page({
          title: 'Missing code',
          body: missingCodeHelp(req),
        })
      );
    }

    success('GET /callback/linkedin', { hasCode: true, state: state ?? null });
    const codeStr = String(code);
    return res.status(200).type('html').send(
      page({
        title: 'LinkedIn authorization code',
        body: `
<p>Copy the code below, then run <code>npm run linkedin:exchange -- "&lt;paste&gt;"</code> from the project root.</p>
<p><strong>state:</strong> <code>${escapeHtml(String(state ?? ''))}</code></p>
<pre id="c">${escapeHtml(codeStr)}</pre>
<p><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('c').textContent)">Copy code</button></p>
`,
      })
    );
  };

  app.get('/callback/linkedin', handler);
  app.get('/callback/linkedin/', handler);
}

function missingCodeHelp(req) {
  const q = req.query ?? {};
  const raw = JSON.stringify(q, null, 2);
  const url = req.originalUrl ?? '';

  return `
<p><strong>LinkedIn did not send a <code>code</code> in the query string.</strong> Common causes:</p>
<ol>
  <li><strong>You opened this address directly</strong> (bookmark, typed URL). Start OAuth from your app: <a href="/oauth/linkedin/start"><code>/oauth/linkedin/start</code></a> (uses Client ID and redirect URI from <code>.env</code>).</li>
  <li><strong><code>redirect_uri</code> mismatch</strong> — the value in your browser’s authorize URL must match <strong>exactly</strong> (including <code>http</code> vs <code>https</code> and port) what is listed under <em>Authorized redirect URLs</em> for your app in the LinkedIn Developer Portal. Our dev server uses <strong>HTTP</strong>: <code>http://localhost:3001/callback/linkedin</code>.</li>
  <li><strong>Wrong app / client id</strong> — the <code>client_id</code> in the authorize URL must be this app’s Client ID.</li>
</ol>
<p><strong>What the server received</strong> (for debugging):</p>
<p><code>${escapeHtml(url)}</code></p>
<pre>${escapeHtml(raw)}</pre>
`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page({ title, body }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}
