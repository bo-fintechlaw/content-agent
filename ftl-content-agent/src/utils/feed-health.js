import { RSS_FEEDS } from '../config/sources.js';
import { fail, start, success } from './logger.js';

const TIMEOUT_MS = 15_000;
const UA =
  'Mozilla/5.0 (compatible; FTL-Content-Agent/1.0; +https://fintechlaw.ai)';

/**
 * Check one feed: HTTP status, content-type, RSS-parseability heuristic,
 * and the latest item's pubDate.
 *
 * @param {{ url: string, category: string, sourceName: string }} feed
 */
async function checkOne(feed) {
  const out = {
    sourceName: feed.sourceName,
    url: feed.url,
    category: feed.category,
    status: 0,
    ok: false,
    parsesAsRss: false,
    firstPubDate: null,
    error: null,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    out.status = res.status;
    out.ok = res.ok;
    if (!res.ok) {
      out.error = `HTTP ${res.status}`;
      return out;
    }
    const body = await res.text();
    out.parsesAsRss = /<(rss|feed|channel)\b/i.test(body);
    if (!out.parsesAsRss) {
      out.error = 'body did not contain <rss>, <feed>, or <channel>';
      return out;
    }
    const dateMatch =
      body.match(/<item\b[\s\S]*?<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/i) ||
      body.match(/<entry\b[\s\S]*?<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/i);
    if (dateMatch) out.firstPubDate = dateMatch[2].trim().slice(0, 30);
  } catch (e) {
    out.error = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e);
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/**
 * Check every feed in RSS_FEEDS. Returns an object with summary counts and
 * per-feed details. Does NOT throw — a network failure is reported, not raised.
 *
 * @returns {Promise<{
 *   total: number,
 *   healthy: number,
 *   broken: number,
 *   results: Array<{ sourceName: string, url: string, category: string, status: number, ok: boolean, parsesAsRss: boolean, firstPubDate: string | null, error: string | null }>
 * }>}
 */
export async function runFeedHealthCheck() {
  start('runFeedHealthCheck', { feedCount: RSS_FEEDS.length });
  try {
    const results = await Promise.all(RSS_FEEDS.map(checkOne));
    const healthy = results.filter((r) => r.ok && r.parsesAsRss).length;
    const broken = results.length - healthy;
    success('runFeedHealthCheck', { total: results.length, healthy, broken });
    return { total: results.length, healthy, broken, results };
  } catch (e) {
    fail('runFeedHealthCheck', e);
    return { total: RSS_FEEDS.length, healthy: 0, broken: RSS_FEEDS.length, results: [] };
  }
}
