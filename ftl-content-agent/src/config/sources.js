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
 *   privacy            — Rikka: state/US privacy law, consumer consent
 *   data_protection    — Rikka: breach, DPA, cross-border transfer
 *   ai_governance      — Rikka: EU AI Act, NIST AI RMF, model risk
 *
 * Each source may include:
 *   brand: 'fintechlaw' | 'rikka'
 *   sourceType: 'rss' | 'html_list'
 *
 * @typedef {(
 *   'regulatory' |
 *   'financial_services' |
 *   'ai_legal_tech' |
 *   'legal_engineering' |
 *   'crypto' |
 *   'fintech' |
 *   'privacy' |
 *   'data_protection' |
 *   'ai_governance'
 * )} TopicCategory
 */

/** @type {{ url: string, category: TopicCategory, sourceName: string }[]} */
const FTL_RSS_BASE = [
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
  {
    url: 'https://www.finra.org/rss.xml',
    category: 'regulatory',
    sourceName: 'FINRA News',
  },
  {
    url: 'https://www.complianceweek.com/rss',
    category: 'regulatory',
    sourceName: 'Compliance Week',
  },
  {
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&count=40&output=atom',
    category: 'regulatory',
    sourceName: 'SEC EDGAR Current Filings',
  },
  {
    url: 'https://www.esma.europa.eu/rss.xml',
    category: 'regulatory',
    sourceName: 'ESMA News',
  },
  {
    url: 'https://www.globallegalpost.com/rss',
    category: 'regulatory',
    sourceName: 'Global Legal Post',
  },
  // FinCEN is email-only via GovDelivery; no parseable RSS today.
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
  {
    url: 'https://www.hedgeweek.com/feed/',
    category: 'financial_services',
    sourceName: 'HedgeWeek',
  },
  {
    url: 'https://www.managedfunds.org/feed/',
    category: 'financial_services',
    sourceName: 'Managed Funds Association',
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
    url: 'https://digitalchamber.org/feed/',
    category: 'crypto',
    sourceName: 'Digital Chamber',
  },
  {
    url: 'https://blockworks.co/feed',
    category: 'crypto',
    sourceName: 'Blockworks',
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
  {
    url: 'https://bankingjournal.aba.com/feed/',
    category: 'fintech',
    sourceName: 'ABA Banking Journal',
  },
  {
    url: 'https://www.paymentsdive.com/feeds/news/',
    category: 'fintech',
    sourceName: 'Payments Dive',
  },
  {
    url: 'https://www.crowdfundinsider.com/feed/',
    category: 'fintech',
    sourceName: 'Crowdfund Insider',
  },
  // American Banker's /feed path returns HTML (paywall redirect) but /rss
  // returns a parseable RSS body. Keep the /rss endpoint; revisit if they
  // tighten access.
];

/** Rikka Law sources — privacy, data protection, AI governance */
const RIKKA_SOURCES_RAW = [
  {
    url: 'https://www.ftc.gov/feeds/press-release-consumer-protection.xml',
    category: 'privacy',
    sourceName: 'FTC Bureau of Consumer Protection',
    brand: 'rikka',
    sourceType: 'rss',
  },
  {
    url: 'https://epic.org/rss',
    category: 'privacy',
    sourceName: 'EPIC',
    brand: 'rikka',
    sourceType: 'rss',
  },
  {
    url: 'https://fpf.org/feed/',
    category: 'privacy',
    sourceName: 'Future of Privacy Forum',
    brand: 'rikka',
    sourceType: 'rss',
  },
  {
    url: 'https://www.nist.gov/news-events/cybersecurity/rss.xml',
    category: 'ai_governance',
    sourceName: 'NIST Cybersecurity News',
    brand: 'rikka',
    sourceType: 'rss',
  },
  {
    url: 'https://iapp.org/news',
    category: 'privacy',
    sourceName: 'IAPP News',
    brand: 'rikka',
    sourceType: 'html_list',
    hrefPattern: /href="(\/news\/[^"#?]+)"/gi,
    baseUrl: 'https://iapp.org',
  },
  {
    url: 'https://www.reuters.com/legal/data-privacy/',
    category: 'data_protection',
    sourceName: 'Reuters Legal — Data Privacy',
    brand: 'rikka',
    sourceType: 'html_list',
    hrefPattern: /href="(\/legal\/data-privacy\/[^"#?]+)"/gi,
    baseUrl: 'https://www.reuters.com',
  },
];

function tagFtlFeed(feed) {
  return { brand: 'fintechlaw', sourceType: 'rss', ...feed };
}

/** All scanner sources (FTL + Rikka), tagged with brand and sourceType */
export const CONTENT_SOURCES = [
  ...FTL_RSS_BASE.map(tagFtlFeed),
  ...RIKKA_SOURCES_RAW,
];

/** @deprecated alias — use CONTENT_SOURCES */
export const RSS_FEEDS = CONTENT_SOURCES;
