/**
 * Default RSS sources for Stage 1 (scanner). Override via `content_config.rss_feeds` later if needed.
 *
 * Categories map to FinTech Law practice areas:
 *   regulatory         — SEC, CFTC, OCC, CFPB, Fed, FDIC, Treasury, DOJ; enforcement and rules
 *   financial_services — RIAs, RICs, private funds, VC funds; trade-press and association feeds
 *   ai_legal_tech      — AI tools in legal/financial services, AI governance, AI policy
 *   legal_engineering  — Law-firm AI adoption, legal operations, practice transformation
 *   crypto             — digital assets, blockchain, DeFi, stablecoins
 *   fintech            — fintech startups, banking/payments, embedded finance
 *
 * @typedef {(
 *   'regulatory' |
 *   'financial_services' |
 *   'ai_legal_tech' |
 *   'legal_engineering' |
 *   'crypto' |
 *   'fintech'
 * )} TopicCategory
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
  {
    url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml',
    category: 'regulatory',
    sourceName: 'CFTC Press Releases',
  },
  {
    url: 'https://www.cftc.gov/RSS/RSSENF/rssenf.xml',
    category: 'regulatory',
    sourceName: 'CFTC Enforcement',
  },
  {
    url: 'https://www.cftc.gov/RSS/RSSST/rssst.xml',
    category: 'regulatory',
    sourceName: 'CFTC Speeches & Testimony',
  },
  {
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    category: 'regulatory',
    sourceName: 'Federal Reserve Press',
  },
  {
    url: 'https://www.federalreserve.gov/feeds/press_enforcement.xml',
    category: 'regulatory',
    sourceName: 'Federal Reserve Enforcement',
  },
  {
    url: 'https://public.govdelivery.com/topics/USFDIC_15/feed.rss',
    category: 'regulatory',
    sourceName: 'FDIC News',
  },
  {
    url: 'https://public.govdelivery.com/topics/USTREAS_88/feed.rss',
    category: 'regulatory',
    sourceName: 'US Treasury News',
  },
  {
    url: 'https://www.justice.gov/news/rss',
    category: 'regulatory',
    sourceName: 'DOJ News',
  },
  {
    url: 'https://www.abajournal.com/news/rss',
    category: 'regulatory',
    sourceName: 'ABA Journal News',
  },
  // FinCEN and FinRA do not publish parseable RSS. FinCEN is email-only via
  // GovDelivery (https://public.govdelivery.com/accounts/USFINCEN/subscriber/new);
  // FinRA's news pages render JS-only with no <link rel="alternate"> feed.
  // Re-add if either ships an RSS endpoint.
  // CFTC RSS feeds (rssenf, rssgp, rssst) all return HTTP 403 even with a
  // browser User-Agent — actively WAF-blocked. Re-add when we have a way
  // around the block (proxy, allowlisted IP, etc.).
  // FinCEN doesn't publish RSS (the /news, /news/speeches, /news/press-releases
  // URLs are HTML landing pages, not feeds). Re-add when they ship one.
  // Federal Register search.rss returns an HTML wrapper to non-RSS user
  // agents (parsed as HTML by rss-parser, not RSS). Re-add if they fix the
  // content negotiation. Regulator-direct feeds above cover the same ground.

  // ── Financial Services (RIAs, RICs, private funds, VC) ────────
  {
    url: 'https://www.investmentadviser.org/feed/',
    category: 'financial_services',
    sourceName: 'Investment Adviser Association',
  },
  {
    url: 'https://www.nasaa.org/feed/',
    category: 'financial_services',
    sourceName: 'NASAA',
  },
  {
    url: 'https://nvca.org/feed/',
    category: 'financial_services',
    sourceName: 'NVCA',
  },
  {
    url: 'https://ilpa.org/feed/',
    category: 'financial_services',
    sourceName: 'ILPA',
  },
  {
    url: 'https://www.investmentnews.com/rss',
    category: 'financial_services',
    sourceName: 'Investment News',
  },
  {
    url: 'https://riabiz.com/rss',
    category: 'financial_services',
    sourceName: 'RIABiz',
  },
  {
    url: 'https://www.wealthmanagement.com/rss.xml',
    category: 'financial_services',
    sourceName: 'WealthManagement.com',
  },
  {
    url: 'https://www.privatefundsmanagement.net/feed/',
    category: 'financial_services',
    sourceName: 'Private Funds Management',
  },
  // ICI, ThinkAdvisor: no working RSS path as of 2026-05; both return 404
  // at common feed URLs. Re-add when they ship one.

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
  {
    url: 'https://www.lawfaremedia.org/feeds/articles',
    category: 'ai_legal_tech',
    sourceName: 'Lawfare',
  },
  {
    url: 'https://jack-clark.net/feed/',
    category: 'ai_legal_tech',
    sourceName: 'Import AI (Jack Clark)',
  },
  // ACM TechNews has no public RSS feed at any standard path — removed.
  // Stanford HAI, Brookings AI, Anthropic news: all return SSR'd HTML to
  // the configured UA at every common feed path. Re-add when they ship
  // proper RSS endpoints.

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

  // ── Legal Engineering & Law-Firm Transformation ───────────────
  {
    url: 'https://www.lawnext.com/feed',
    category: 'legal_engineering',
    sourceName: 'LawSites (Bob Ambrogi)',
  },
  {
    url: 'https://adamsmithesq.com/feed/',
    category: 'legal_engineering',
    sourceName: 'Adam Smith Esq',
  },
  {
    url: 'https://www.geeklawblog.com/feed',
    category: 'legal_engineering',
    sourceName: '3 Geeks and a Law Blog',
  },
  {
    url: 'https://www.legalevolution.org/feed/',
    category: 'legal_engineering',
    sourceName: 'Legal Evolution',
  },
  {
    url: 'https://rss.arxiv.org/rss/cs.CY',
    category: 'legal_engineering',
    sourceName: 'arXiv Computers & Society',
  },
  // Stanford CodeX has no working RSS endpoint at /codex-the-stanford-center-for-legal-informatics/feed/
  // (returns 404). The page is a Stanford Law section, not a WordPress blog. Re-add if/when they ship one.
  // SSRN's Legal Scholarship Network journal feeds are Cloudflare-WAF-blocked even with a browser UA
  // (same pattern as CFTC). Re-add when we have a proxy / allowlisted IP / API access path.

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

  // ── FinTech, Banking & Payments ───────────────────────────────
  {
    url: 'https://www.finextra.com/rss/headlines.aspx',
    category: 'fintech',
    sourceName: 'Finextra',
  },
  {
    url: 'https://www.pymnts.com/feed/',
    category: 'fintech',
    sourceName: 'PYMNTS',
  },
  {
    url: 'https://news.crunchbase.com/feed/',
    category: 'fintech',
    sourceName: 'Crunchbase News',
  },
  {
    url: 'https://techcrunch.com/category/fintech/feed/',
    category: 'fintech',
    sourceName: 'TechCrunch Fintech',
  },
  {
    url: 'https://techcrunch.com/category/venture/feed/',
    category: 'fintech',
    sourceName: 'TechCrunch Venture',
  },
  {
    url: 'https://www.bankingdive.com/feeds/news/',
    category: 'fintech',
    sourceName: 'Banking Dive',
  },
  {
    url: 'https://finovate.com/feed/',
    category: 'fintech',
    sourceName: 'Finovate',
  },
  {
    url: 'https://www.americanbanker.com/rss',
    category: 'fintech',
    sourceName: 'American Banker',
  },
  // American Banker's /feed path returns HTML (paywall redirect) but /rss
  // returns a parseable RSS body. Keep the /rss endpoint; revisit if they
  // tighten access.
];
