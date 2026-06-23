import Parser from 'rss-parser';
import { CONTENT_SOURCES } from '../config/sources.js';
import { getEnabledBrands } from '../config/brands/index.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fetchHtmlListItems } from './html-list-scanner.js';
import { fail, start, success } from '../utils/logger.js';

const parser = new Parser({
  timeout: 25000,
  headers: {
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
    'User-Agent':
      'FTL-Content-Agent/1.0 (+https://fintechlaw.ai; pipeline scanner)',
  },
});

const DEFAULT_WINDOW_HOURS = 168;
const DEFAULT_ITEMS_PER_FEED = 35;

function windowHoursFromEnv(options = {}) {
  const fromOpt = options.windowHours;
  if (fromOpt != null && Number.isFinite(Number(fromOpt)) && Number(fromOpt) > 0) {
    return Number(fromOpt);
  }
  const raw = process.env.SCAN_WINDOW_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WINDOW_HOURS;
}

function itemsPerFeedFromEnv() {
  const raw = process.env.SCAN_ITEMS_PER_FEED;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ITEMS_PER_FEED;
}

/**
 * Stage 1: fetch configured sources (RSS + html_list), dedupe by `source_url`,
 * insert new rows into `content_topics` with brand_id.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ windowHours?: number, config?: Record<string, any> }} [options]
 */
export async function runSourceScan(supabase, options = {}) {
  start('runSourceScan');

  const stats = {
    inserted: 0,
    skipped: 0,
    errors: [],
    feedsProcessed: 0,
  };

  const enabledBrandIds = new Set(
    getEnabledBrands(options.config ?? {}).map((b) => b.id)
  );

  try {
    const windowHours = windowHoursFromEnv(options);
    const itemCap = itemsPerFeedFromEnv();
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    for (const feedConfig of CONTENT_SOURCES) {
      const brandId = feedConfig.brand ?? 'fintechlaw';
      if (!enabledBrandIds.has(brandId)) continue;

      const sourceType = feedConfig.sourceType ?? 'rss';
      let items = [];

      if (sourceType === 'html_list') {
        items = await fetchHtmlListFromConfig(feedConfig, itemCap);
      } else {
        items = await fetchRssItemsFromConfig(feedConfig, cutoff, itemCap, stats);
      }

      if (!items.length) continue;
      stats.feedsProcessed++;

      for (const item of items) {
        const sourceUrl = normalizeUrl(item.link);
        if (!sourceUrl || !item.title) continue;

        const summary = buildSummary(item);

        const { data: existing, error: selErr } = await supabase
          .from('content_topics')
          .select('id')
          .eq('source_url', sourceUrl)
          .maybeSingle();

        if (selErr) {
          stats.errors.push({
            sourceUrl,
            error: `duplicate check: ${selErr.message}`,
          });
          fail('runSourceScan', new Error(selErr.message), { sourceUrl });
          continue;
        }

        if (existing) {
          stats.skipped++;
          continue;
        }

        const { error: insErr } = await supabase.from('content_topics').insert({
          source_url: sourceUrl,
          source_name: feedConfig.sourceName,
          title: item.title.trim().slice(0, 2000),
          summary,
          category: feedConfig.category,
          brand_id: brandId,
          status: 'pending',
          suggested_by: 'scanner',
        });

        if (insErr) {
          stats.errors.push({ sourceUrl, error: insErr.message });
          fail('runSourceScan', new Error(insErr.message), {
            sourceUrl,
            code: insErr.code,
          });
        } else {
          stats.inserted++;
        }
      }
    }

    success('runSourceScan', stats);
    return stats;
  } catch (error) {
    fail('runSourceScan', error);
    throw error;
  }
}

async function fetchRssItemsFromConfig(feedConfig, cutoff, itemCap, stats) {
  const breaker = new CircuitBreaker(`rss:${feedConfig.sourceName}`);
  const feed = await breaker.execute(() => parser.parseURL(feedConfig.url), null);

  if (feed === null) {
    stats.errors.push({
      feed: feedConfig.url,
      error: 'RSS fetch failed or circuit open',
    });
    return [];
  }

  const allItems = feed.items ?? [];
  return allItems
    .filter((item) => {
      const pubDate = item.pubDate || item.isoDate;
      if (!pubDate) return true;
      return new Date(pubDate) >= cutoff;
    })
    .slice(0, itemCap)
    .map((item) => ({
      title: item.title,
      link: itemLink(item),
      contentSnippet: item.contentSnippet,
      content: item.content,
      summary: item.summary,
      description: item.description,
    }));
}

async function fetchHtmlListFromConfig(feedConfig, itemCap) {
  const breaker = new CircuitBreaker(`html:${feedConfig.sourceName}`);
  return (
    (await breaker.execute(
      () =>
        fetchHtmlListItems({
          url: feedConfig.url,
          sourceName: feedConfig.sourceName,
          hrefPattern: feedConfig.hrefPattern,
          baseUrl: feedConfig.baseUrl,
          maxItems: itemCap,
        }),
      []
    )) ?? []
  );
}

function itemLink(item) {
  if (item.link && typeof item.link === 'string') return item.link;
  if (item.link && typeof item.link === 'object' && item.link.href)
    return item.link.href;
  if (typeof item.guid === 'string') return item.guid;
  if (item.guid && typeof item.guid === 'object' && item.guid._)
    return String(item.guid._);
  return '';
}

function normalizeUrl(href) {
  if (!href || typeof href !== 'string') return '';
  try {
    const u = new URL(href.trim());
    return u.toString();
  } catch {
    return href.trim();
  }
}

function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, ' ');
}

function buildSummary(item) {
  const raw =
    item.contentSnippet ||
    item.content ||
    item.summary ||
    item.description ||
    '';
  const text = stripHtml(raw).replace(/\s+/g, ' ').trim();
  if (text.length <= 600) return text;
  return `${text.slice(0, 597)}...`;
}
