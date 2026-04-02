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
    url: 'https://www.sec.gov/litigation/litreleases.rss',
    category: 'regulatory',
    sourceName: 'SEC Litigation Releases',
  },
  {
    url: 'https://www.cftc.gov/Newsroom/PressReleases/RSS',
    category: 'regulatory',
    sourceName: 'CFTC Press Releases',
  },
  {
    url: 'https://www.occ.treas.gov/news-issuances/news-releases/rss-feed.xml',
    category: 'regulatory',
    sourceName: 'OCC News Releases',
  },
  {
    url: 'https://www.fincen.gov/news/news-releases/rss.xml',
    category: 'regulatory',
    sourceName: 'FinCEN News',
  },
  {
    url: 'https://www.consumerfinance.gov/about-us/newsroom/feed/',
    category: 'regulatory',
    sourceName: 'CFPB Newsroom',
  },

  // ── AI, Legal Tech & RegTech ──────────────────────────────────
  {
    url: 'https://www.artificiallawyer.com/feed/',
    category: 'ai_legal_tech',
    sourceName: 'Artificial Lawyer',
  },
  {
    url: 'https://technews.acm.org/archives.cfm?fo=rss',
    category: 'ai_legal_tech',
    sourceName: 'ACM TechNews',
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

  // ── AI Companies & Research ───────────────────────────────────
  {
    url: 'https://www.therundown.ai/feed',
    category: 'ai_legal_tech',
    sourceName: 'The Rundown AI',
  },
  {
    url: 'https://rohanpaul.substack.com/feed',
    category: 'ai_legal_tech',
    sourceName: "Rohan's Bytes",
  },
  {
    url: 'https://www.anthropic.com/rss.xml',
    category: 'ai_legal_tech',
    sourceName: 'Anthropic',
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
    url: 'https://www.americanbanker.com/feed',
    category: 'startup',
    sourceName: 'American Banker',
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
];
