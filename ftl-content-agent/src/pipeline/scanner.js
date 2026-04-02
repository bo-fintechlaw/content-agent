import Parser from 'rss-parser';
import { RSS_FEEDS } from '../config/sources.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const parser = new Parser({
  timeout: 25000,
  headers: {
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
    'User-Agent':
      'FTL-Content-Agent/1.0 (+https://fintechlaw.com; pipeline scanner)',
  },
});

/**
 * Stage 1: fetch configured RSS feeds, dedupe by `source_url`, insert new rows into `content_topics`.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{ inserted: number, skipped: number, errors: Array<{ feed?: string, sourceUrl?: string, error: string }>, feedsProcessed: number }>}
 */
export async function runSourceScan(supabase) {
  start('runSourceScan');

  const stats = {
    inserted: 0,
    skipped: 0,
    errors: [],
    feedsProcessed: 0,
  };

  try {
    for (const feedConfig of RSS_FEEDS) {
      const breaker = new CircuitBreaker(`rss:${feedConfig.sourceName}`);

      const feed = await breaker.execute(
        () => parser.parseURL(feedConfig.url),
        null
      );

      if (feed === null) {
        stats.errors.push({
          feed: feedConfig.url,
          error: 'RSS fetch failed or circuit open',
        });
        continue;
      }

      stats.feedsProcessed++;
      const allItems = feed.items ?? [];

      // Limit to 10 most recent items per feed, published within last 48 hours
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const items = allItems
        .filter((item) => {
          const pubDate = item.pubDate || item.isoDate;
          if (!pubDate) return true; // include items without dates
          return new Date(pubDate) >= cutoff;
        })
        .slice(0, 10);

      for (const item of items) {
        const sourceUrl = normalizeUrl(itemLink(item));
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
