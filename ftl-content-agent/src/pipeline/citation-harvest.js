import { start, success } from '../utils/logger.js';

const MAX_URLS = 10;
const FETCH_TIMEOUT_MS = 12_000;
const PREVIEW_MAX_CHARS = 4_000;

const URL_IN_TEXT_RE = /https?:\/\/[^\s\])"'<>\n]+/g;

// Domains we publish ourselves. The drafter intentionally links to
// fintechlaw.ai/contact (CTA) and to the future blog permalink
// fintechlaw.ai/blog/<slug> in social posts. Neither is a citation:
//   - The CTAs are not external evidence for any claim.
//   - The future permalink 404s pre-publish — fetching it generates a
//     false-positive "broken citation" flag from the subagent.
// Strip them at extraction so they never reach the fetch step or the judge.
const SELF_CITATION_HOSTS = new Set(['fintechlaw.ai', 'www.fintechlaw.ai']);

function isSelfCitationUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return SELF_CITATION_HOSTS.has(host);
  } catch {
    return false;
  }
}

// Dedupe key: hostname + pathname (no query, no trailing slash). Catches the
// drafter writing both a UTM-tagged URL and a clean URL of the same article.
function urlDedupeKey(url) {
  try {
    const u = new URL(String(url));
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.hostname.toLowerCase()}${path}`;
  } catch {
    return String(url);
  }
}

/**
 * Strip trailing punctuation often captured with URLs in prose.
 * @param {string} s
 */
function cleanUrlString(s) {
  return s.replace(/[),.;:]+$/g, '').trim();
}

/**
 * Walk a JSON-serializable value and collect http(s) URLs.
 * @param {unknown} v
 * @param {Set<string>} out
 */
function walkForUrls(v, out) {
  if (v == null) return;
  if (typeof v === 'string') {
    const re = new RegExp(URL_IN_TEXT_RE.source, 'g');
    let m;
    while ((m = re.exec(v)) !== null) {
      const u = cleanUrlString(m[0]);
      if (u.startsWith('http://') || u.startsWith('https://')) {
        out.add(u);
      }
    }
  } else if (Array.isArray(v)) {
    for (const x of v) walkForUrls(x, out);
  } else if (typeof v === 'object') {
    for (const k of Object.keys(v)) {
      walkForUrls(v[k], out);
    }
  }
}

/**
 * @param {object} draft — content_drafts row
 * @returns {string[]} unique URL list (capped)
 */
export function extractHttpUrlsFromDraft(draft) {
  const s = new Set();
  if (draft?.blog_title) walkForUrls(draft.blog_title, s);
  if (draft?.blog_body) walkForUrls(draft.blog_body, s);
  if (draft?.blog_seo_title) walkForUrls(draft.blog_seo_title, s);
  if (draft?.blog_seo_description) walkForUrls(draft.blog_seo_description, s);
  if (draft?.linkedin_post) walkForUrls(draft.linkedin_post, s);
  if (draft?.x_post) walkForUrls(draft.x_post, s);
  if (draft?.x_thread) walkForUrls(draft.x_thread, s);

  // Dedupe by hostname+path — collapses utm-tagged + clean variants of the
  // same article. Prefer the URL without a query string when both forms appear.
  const byPath = new Map();
  for (const u of s) {
    if (isSelfCitationUrl(u)) continue;
    const key = urlDedupeKey(u);
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, u);
      continue;
    }
    if (existing.includes('?') && !u.includes('?')) byPath.set(key, u);
  }
  return [...byPath.values()].slice(0, MAX_URLS);
}

function extractTitleFromHtml(html) {
  const m = String(html).match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function stripToTextPreview(html) {
  return String(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_MAX_CHARS);
}

/**
 * @param {string} url
 * @returns {Promise<{
 *   url: string,
 *   finalUrl: string,
 *   ok: boolean,
 *   status: number,
 *   contentType: string,
 *   title: string | null,
 *   textPreview: string,
 *   error: string | null
 * }>}
 */
export async function fetchOneCitationUrl(url) {
  const u = String(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'FTL-ContentAgent/1.0 (+https://fintechlaw.ai) citation verification',
        Accept: 'text/html,application/json;q=0.8,*/*;q=0.5',
      },
      redirect: 'follow',
    });
    const finalUrl = res.url;
    const status = res.status;
    const contentType = res.headers.get('content-type') || '';
    const ok = res.ok;
    let title = null;
    let textPreview = '';
    if (ok) {
      const buf = await res.arrayBuffer();
      const asText = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (contentType.includes('text/html') || asText.trim().startsWith('<!')) {
        title = extractTitleFromHtml(asText) || null;
        textPreview = stripToTextPreview(asText);
      } else {
        textPreview = asText.slice(0, PREVIEW_MAX_CHARS);
      }
    }
    clearTimeout(t);
    return {
      url: u,
      finalUrl: finalUrl || u,
      ok,
      status,
      contentType,
      title,
      textPreview,
      error: null,
    };
  } catch (e) {
    clearTimeout(t);
    const err = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e));
    return {
      url: u,
      finalUrl: u,
      ok: false,
      status: 0,
      contentType: '',
      title: null,
      textPreview: '',
      error: err,
    };
  }
}

/**
 * Fetch all cited URLs with modest concurrency.
 * @param {string[]} urls
 * @returns {Promise<ReturnType<typeof fetchOneCitationUrl>[]>}
 */
export async function fetchAllCitationPreviews(urls) {
  start('fetchAllCitationPreviews', { count: urls?.length ?? 0 });
  const list = (urls || []).filter(Boolean);
  if (!list.length) {
    success('fetchAllCitationPreviews', { count: 0 });
    return [];
  }
  const out = [];
  for (const u of list) {
    try {
      // Sequential to avoid tripping server rate limits on gov sites
      out.push(await fetchOneCitationUrl(u));
    } catch (e) {
      out.push({
        url: u,
        finalUrl: u,
        ok: false,
        status: 0,
        contentType: '',
        title: null,
        textPreview: '',
        error: e?.message || String(e),
      });
    }
  }
  success('fetchAllCitationPreviews', { count: out.length });
  return out;
}
