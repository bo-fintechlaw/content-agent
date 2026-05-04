/**
 * Default RSS sources for Stage 1 (scanner). Override via `content_config.rss_feeds` later if needed.
 *
 * Categories map to FinTech Law practice areas:
 *   regulatory    — SEC, CFTC, OCC, FinCEN, state regulators, enforcement actions
 *   ai_legal_tech — AI in legal/financial services, regtech, legal ops
 *   crypto        — digital assets, blockchain, DeFi, stablecoins
 *   startup       — fintech startups, funding rounds, neobanks, payments
 *
 * @typedef {'regulatory' | 'ai_legal_tech' | 'startup' | 'crypto'} TopicCategory
 */

/** @type {{ url: string, category: TopicCategory, sourceName: string }[]} */
export const RSS_FEEDS = [
  // ── Regulatory & Enforcement ──────────────────────────────────
  {
    url: 'https://www.sec.gov/news/pressreleases.rss',
    category: 'regulatory',
    sourceName: 'SEC Press Releases',
  },
  {
    url: 'https://www.sec.gov/enforcement-litigation/litigation-releases/rss',
    category: 'regulatory',
    sourceName: 'SEC Litigation Releases',
  },
  {
    url: 'https://www.sec.gov/news/speeches-statements.rss',
    category: 'regulatory',
    sourceName: 'SEC Speeches & Statements',
  },
  {
    url: 'https://www.occ.gov/rss/occ_news.xml',
    category: 'regulatory',
    sourceName: 'OCC News',
  },
  {
    url: 'https://www.occ.gov/rss/occ-speeches.xml',
    category: 'regulatory',
    sourceName: 'OCC Speeches',
  },
  {
    url: 'https://www.consumerfinance.gov/about-us/newsroom/feed/',
    category: 'regulatory',
    sourceName: 'CFPB Newsroom',
  },
  // CFTC RSS feeds (rssenf, rssgp, rssst) all return HTTP 403 even with a
  // browser User-Agent — actively WAF-blocked. Re-add when we have a way
  // around the block (proxy, allowlisted IP, etc.).
  // FinCEN doesn't publish RSS (the /news, /news/speeches, /news/press-releases
  // URLs are HTML landing pages, not feeds). Re-add when they ship one.

  // ── AI, Legal Tech & RegTech ──────────────────────────────────
  {
    url: 'https://www.artificiallawyer.com/feed/',
    category: 'ai_legal_tech',
    sourceName: 'Artificial Lawyer',
  },
  {
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    category: 'ai_legal_tech',
    sourceName: 'TechCrunch AI',
  },
  {
    url: 'https://venturebeat.com/category/ai/feed/',
    category: 'ai_legal_tech',
    sourceName: 'VentureBeat AI',
  },
  // ACM TechNews has no public RSS feed at any standard path — removed.

  // ── AI Companies & Research ───────────────────────────────────
  {
    url: 'https://www.rohan-paul.com/feed',
    category: 'ai_legal_tech',
    sourceName: "Rohan's Bytes",
  },
  {
    url: 'https://openai.com/blog/rss.xml',
    category: 'ai_legal_tech',
    sourceName: 'OpenAI Blog',
  },
  {
    url: 'https://blogs.nvidia.com/feed/',
    category: 'ai_legal_tech',
    sourceName: 'NVIDIA Blog',
  },
  // Anthropic and The Rundown AI dropped — neither publishes a working RSS
  // at the previously-listed paths. Re-add if/when they do.

  // ── Crypto, Digital Assets & DeFi ─────────────────────────────
  {
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    category: 'crypto',
    sourceName: 'CoinDesk',
  },
  {
    url: 'https://cointelegraph.com/rss',
    category: 'crypto',
    sourceName: 'CoinTelegraph',
  },
  {
    url: 'https://www.theblock.co/rss.xml',
    category: 'crypto',
    sourceName: 'The Block',
  },
  {
    url: 'https://decrypt.co/feed',
    category: 'crypto',
    sourceName: 'Decrypt',
  },

  // ── FinTech Startups, Banking & Payments ──────────────────────
  {
    url: 'https://www.finextra.com/rss/headlines.aspx',
    category: 'startup',
    sourceName: 'Finextra',
  },
  {
    url: 'https://www.pymnts.com/feed/',
    category: 'startup',
    sourceName: 'PYMNTS',
  },
  {
    url: 'https://news.crunchbase.com/feed/',
    category: 'startup',
    sourceName: 'Crunchbase News',
  },
  {
    url: 'https://techcrunch.com/category/fintech/feed/',
    category: 'startup',
    sourceName: 'TechCrunch Fintech',
  },
  // American Banker dropped — /feed returns HTML (paywall/login redirect),
  // not a parseable RSS body.
];
