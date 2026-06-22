# Feed health audit — 2026-06-21

Run: `node -e "import { runFeedHealthCheck } from './src/utils/feed-health.js'; ..."`

## Summary

| Status | Count |
|--------|-------|
| Total | 48 |
| Healthy | 44 |
| Broken | 4 |

## Remove / disable (broken)

| Source | Issue |
|--------|-------|
| CFTC Press Releases | HTTP 403 (WAF) |
| CFTC Enforcement | HTTP 403 |
| CFTC Speeches & Testimony | HTTP 403 |
| CoinTelegraph | Does not parse as RSS |

## Keep (44 healthy)

All other feeds in `src/config/sources.js` passed HTTP + RSS parse checks.

## Action taken in this PR

- CFTC feeds and CoinTelegraph removed from active `RSS_FEEDS`
- Added FTL regulatory/fund feeds and Rikka privacy sources per expansion plan
