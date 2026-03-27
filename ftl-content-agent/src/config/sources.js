/**
 * Default RSS sources for Stage 1 (scanner). Override via `content_config.rss_feeds` later if needed.
 *
 * @typedef {'regulatory' | 'ai_legal_tech' | 'startup' | 'crypto'} TopicCategory
 */

/** @type {{ url: string, category: TopicCategory, sourceName: string }[]} */
export const RSS_FEEDS = [
  {
    url: 'https://www.artificiallawyer.com/feed/',
    category: 'ai_legal_tech',
    sourceName: 'Artificial Lawyer',
  },
  {
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    category: 'crypto',
    sourceName: 'CoinDesk',
  },
  {
    url: 'https://www.sec.gov/news/pressreleases.rss',
    category: 'regulatory',
    sourceName: 'SEC Press Releases',
  },
];
