/**
 * SEO keywords organized by topic-source category, so the ranker and drafter
 * only see the cluster relevant to a given topic — not a flat 12-keyword list
 * that pushed irrelevant sections (money transmitter, ToS, privacy policy)
 * into every article regardless of fit.
 *
 * Keys mirror the TopicCategory values in src/config/sources.js.
 */

/**
 * @typedef {(
 *   'regulatory' |
 *   'financial_services' |
 *   'ai_legal_tech' |
 *   'legal_engineering' |
 *   'crypto' |
 *   'fintech' |
 *   'consumer_compliance'
 * )} TopicCategory
 */

/** @type {Record<TopicCategory, string[]>} */
export const SEO_KEYWORD_CLUSTERS = {
  regulatory: [
    'SEC enforcement',
    'CFPB regulation',
    'CFTC enforcement',
    'investment adviser compliance',
    'broker-dealer compliance',
    'fiduciary duty',
    'rulemaking',
    'advisory agreement',
  ],
  financial_services: [
    'RIA compliance',
    'Form ADV',
    'custody rule',
    'marketing rule',
    'fund formation',
    'private fund adviser',
    'exempt reporting adviser',
    'fiduciary duty',
    'Reg BI',
    'fund administration',
    'LP-GP agreement',
    'venture capital fund',
  ],
  crypto: [
    'tokenization',
    'digital assets',
    'cryptocurrency regulation',
    'stablecoin regulation',
    'SEC enforcement',
    'digital asset compliance',
  ],
  ai_legal_tech: [
    'AI legal tech',
    'legal AI',
    'AI compliance',
    'AI governance',
    'AI in financial services',
    'fintech AI',
  ],
  legal_engineering: [
    'legal engineering',
    'law firm AI',
    'legal operations',
    'AI-native law firm',
    'alternative legal services',
    'law firm innovation',
  ],
  fintech: [
    'fintech regulation',
    'embedded finance',
    'BSA/AML',
    'OCC charter',
    'state lending license',
    'payments compliance',
    'partner bank',
    'banking-as-a-service',
  ],
  // Narrow opt-in cluster — NOT assigned to any RSS feed. Used only for
  // manually-suggested topics where consumer-finance compliance (terms of
  // service, privacy policy, money transmitter regulation) is the actual
  // central focus of the news. Keeping these out of every default category
  // is what stops the drafter from defaulting every blog post to an MTL/ToS
  // framing regardless of subject.
  consumer_compliance: [
    'money transmitter',
    'terms of service',
    'privacy policy',
    'consumer disclosures',
    'UDAAP',
  ],
};

/**
 * Resolve the keyword cluster for a topic's category. Falls back to a
 * deduped union of all clusters if the category is unknown or missing.
 *
 * @param {string | null | undefined} category
 * @returns {string[]}
 */
export function getKeywordsForCategory(category) {
  if (category && Object.prototype.hasOwnProperty.call(SEO_KEYWORD_CLUSTERS, category)) {
    return SEO_KEYWORD_CLUSTERS[category];
  }
  return DEFAULT_SEO_KEYWORDS;
}

/**
 * Deduped union of all clusters EXCEPT consumer_compliance. Used as the
 * fallback for unknown categories. consumer_compliance is held back so an
 * unclassified topic does not get seeded with MTL/ToS/privacy keywords.
 */
export const DEFAULT_SEO_KEYWORDS = Array.from(
  new Set(
    Object.entries(SEO_KEYWORD_CLUSTERS)
      .filter(([key]) => key !== 'consumer_compliance')
      .flatMap(([, kws]) => kws)
  )
);
