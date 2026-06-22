import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail } from '../utils/logger.js';

const DEFAULT_UA =
  'Mozilla/5.0 (compatible; FTL-Content-Agent/1.0; +https://fintechlaw.ai)';

/**
 * Fetch an HTML listing page and extract article links.
 *
 * @param {{
 *   url: string,
 *   sourceName: string,
 *   hrefPattern?: RegExp,
 *   baseUrl?: string,
 *   maxItems?: number,
 * }} source
 * @returns {Promise<Array<{ title: string, link: string, summary: string }>>}
 */
export async function fetchHtmlListItems(source) {
  const breaker = new CircuitBreaker(`html:${source.sourceName}`);
  const html = await breaker.execute(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(source.url, {
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }, null);

  if (!html) return [];

  const base = source.baseUrl ?? source.url;
  const hrefPattern =
    source.hrefPattern ?? /href="(\/[^"#?]+)"/gi;
  const maxItems = source.maxItems ?? 35;
  const seen = new Set();
  const items = [];

  let match;
  const pattern =
    hrefPattern instanceof RegExp
      ? new RegExp(hrefPattern.source, hrefPattern.flags.includes('g') ? hrefPattern.flags : `${hrefPattern.flags}g`)
      : hrefPattern;

  while ((match = pattern.exec(html)) !== null && items.length < maxItems) {
    const href = match[1] ?? match[0];
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue;

    let link;
    try {
      link = new URL(href, base).toString();
    } catch {
      continue;
    }

    if (seen.has(link)) continue;
    seen.add(link);

    const title = extractTitleNearLink(html, href) ?? link;
    if (!title || title.length < 12) continue;

    items.push({
      title: title.trim().slice(0, 2000),
      link,
      summary: '',
    });
  }

  return items;
}

function extractTitleNearLink(html, href) {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchorRe = new RegExp(
    `<a[^>]+href=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/a>`,
    'i'
  );
  const m = html.match(anchorRe);
  if (!m) return null;
  return stripHtml(m[1]).replace(/\s+/g, ' ').trim();
}

function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Health-check an html_list source — returns whether article links were found.
 * @param {{ url: string, sourceName: string, hrefPattern?: RegExp, baseUrl?: string }} source
 */
export async function checkHtmlListSource(source) {
  const out = {
    sourceName: source.sourceName,
    url: source.url,
    category: source.category,
    brand: source.brand,
    sourceType: 'html_list',
    status: 0,
    ok: false,
    parsesAsRss: false,
    parsesAsHtmlList: false,
    linkCount: 0,
    firstPubDate: null,
    error: null,
  };

  try {
    const items = await fetchHtmlListItems({ ...source, maxItems: 5 });
    out.parsesAsHtmlList = items.length > 0;
    out.linkCount = items.length;
    out.ok = out.parsesAsHtmlList;
    out.status = out.ok ? 200 : 0;
    if (!out.ok) out.error = 'no parseable article links found';
  } catch (e) {
    out.error = String(e?.message ?? e);
  }

  return out;
}
