#!/usr/bin/env node
// Hit each feed in src/config/sources.js and report status. No DB writes,
// no Anthropic calls — pure diagnostic.
//
// Usage:
//   node scripts/check-rss-feeds.mjs
//   node scripts/check-rss-feeds.mjs --json    # machine-readable output

import { runFeedHealthCheck } from '../src/utils/feed-health.js';

const jsonMode = process.argv.includes('--json');
const { total, healthy, broken, results } = await runFeedHealthCheck();

if (jsonMode) {
  console.log(JSON.stringify({ total, healthy, broken, results }, null, 2));
  process.exit(0);
}

console.log(`\n=== ${healthy}/${total} feeds healthy ===\n`);

const brokenRows = results.filter((r) => !r.ok || !r.parsesAsRss);
if (brokenRows.length) {
  console.log('BROKEN OR UNPARSEABLE:');
  for (const r of brokenRows) {
    const why = r.error || `status ${r.status}`;
    console.log(`  ✗ ${r.sourceName.padEnd(28)}  ${why}`);
    console.log(`    ${r.url}`);
  }
  console.log();
}

console.log('HEALTHY:');
for (const r of results.filter((r) => r.ok && r.parsesAsRss)) {
  const recent = r.firstPubDate ? `(latest: ${r.firstPubDate.slice(0, 25)})` : '';
  console.log(`  ✓ ${r.sourceName.padEnd(28)}  ${recent}`);
}
console.log();
