#!/usr/bin/env node
// Hit each feed in src/config/sources.js and report:
//   - HTTP status (200/403/404/etc.)
//   - Content-Type
//   - Whether the body is parseable XML/RSS (heuristic, not full parse)
//   - First item title + pubDate when available
//
// Usage:
//   node scripts/check-rss-feeds.mjs
//   node scripts/check-rss-feeds.mjs --json    # machine-readable output
//
// No DB writes, no Anthropic calls — pure diagnostic.

import { RSS_FEEDS } from '../src/config/sources.js';

const TIMEOUT_MS = 15_000;
const UA =
  'Mozilla/5.0 (compatible; FTL-Content-Agent/1.0; +https://fintechlaw.ai)';

async function checkOne(feed) {
  const out = {
    sourceName: feed.sourceName,
    url: feed.url,
    category: feed.category,
    status: 0,
    ok: false,
    contentType: '',
    parsesAsRss: false,
    firstTitle: null,
    firstPubDate: null,
    error: null,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    out.status = res.status;
    out.ok = res.ok;
    out.contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      out.error = `HTTP ${res.status}`;
      return out;
    }
    const body = await res.text();
    // Heuristic parse: look for <rss>, <feed> (Atom), or <channel>
    const looksLikeRss = /<(rss|feed|channel)\b/i.test(body);
    out.parsesAsRss = looksLikeRss;
    if (!looksLikeRss) {
      out.error = 'body did not contain <rss>, <feed>, or <channel>';
      return out;
    }
    // Extract first item title + pubDate (best-effort regex; not a real parser)
    const titleMatch = body.match(/<item\b[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)
      || body.match(/<entry\b[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      out.firstTitle = titleMatch[1]
        .replace(/<!\[CDATA\[/, '')
        .replace(/\]\]>/, '')
        .trim()
        .slice(0, 120);
    }
    const dateMatch = body.match(/<item\b[\s\S]*?<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/i)
      || body.match(/<entry\b[\s\S]*?<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/i);
    if (dateMatch) out.firstPubDate = dateMatch[2].trim();
  } catch (e) {
    out.error = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e);
  } finally {
    clearTimeout(timer);
  }
  return out;
}

const jsonMode = process.argv.includes('--json');
const results = await Promise.all(RSS_FEEDS.map(checkOne));

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const broken = results.filter((r) => !r.ok || !r.parsesAsRss);
const working = results.filter((r) => r.ok && r.parsesAsRss);

console.log(`\n=== ${working.length}/${results.length} feeds healthy ===\n`);

if (broken.length) {
  console.log('BROKEN OR UNPARSEABLE:');
  for (const r of broken) {
    const why = r.error || `status ${r.status}`;
    console.log(`  ✗ ${r.sourceName.padEnd(28)}  ${why}`);
    console.log(`    ${r.url}`);
  }
  console.log();
}

console.log('HEALTHY:');
for (const r of working) {
  const recent = r.firstPubDate ? `(latest: ${r.firstPubDate.slice(0, 25)})` : '';
  console.log(`  ✓ ${r.sourceName.padEnd(28)}  ${recent}`);
}
console.log();
