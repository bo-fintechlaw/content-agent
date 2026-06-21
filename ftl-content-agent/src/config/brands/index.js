import { fintechlawBrand } from './fintechlaw.js';
import { rikkaBrand } from './rikka.js';

/**
 * @typedef {Object} BrandAuthor
 * @property {string} name
 * @property {string} title
 */

/**
 * @typedef {Object} BrandConfig
 * @property {string} id
 * @property {string} displayName
 * @property {'live' | 'ftl_test' | 'live_rikka'} publishMode
 * @property {string} siteUrl
 * @property {string} slackLabel
 * @property {string[]} categories
 * @property {Record<string, string>} blogCategoryMap
 * @property {BrandAuthor} author
 * @property {Record<string, any>} prompts
 */

/** @type {Record<string, BrandConfig>} */
export const BRANDS = {
  fintechlaw: fintechlawBrand,
  rikka: rikkaBrand,
};

export const DEFAULT_BRAND_ID = 'fintechlaw';

/**
 * @param {string | null | undefined} brandId
 * @returns {BrandConfig}
 */
export function getBrand(brandId) {
  const id = String(brandId ?? DEFAULT_BRAND_ID).trim() || DEFAULT_BRAND_ID;
  return BRANDS[id] ?? BRANDS[DEFAULT_BRAND_ID];
}

/**
 * @param {Record<string, any>} config
 * @returns {BrandConfig[]}
 */
export function getEnabledBrands(config) {
  const enableRikka =
    String(config?.ENABLE_RIKKA_PIPELINE ?? process.env.ENABLE_RIKKA_PIPELINE ?? '')
      .toLowerCase() === 'true';
  const brands = [BRANDS.fintechlaw];
  if (enableRikka) brands.push(BRANDS.rikka);
  return brands;
}

/**
 * Resolve Sanity blog category for a draft topic category.
 * @param {string} brandId
 * @param {string | null | undefined} topicCategory
 * @param {string | null | undefined} draftCategory
 */
export function resolveBlogCategory(brandId, topicCategory, draftCategory) {
  const brand = getBrand(brandId);
  const mapped = brand.blogCategoryMap[String(topicCategory ?? '').trim()];
  if (mapped) return mapped;
  return String(draftCategory ?? topicCategory ?? 'business').trim() || 'business';
}
