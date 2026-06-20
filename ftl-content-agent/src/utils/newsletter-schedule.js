import { NEWSLETTER_SEGMENTS } from '../schemas/newsletter.js';

/** @typedef {typeof NEWSLETTER_SEGMENTS[number]} NewsletterSegment */

/**
 * First scheduled assemble/send date per segment (America/New_York calendar dates).
 * Each segment runs biweekly (every 14 days) on Thursdays from its anchor.
 *
 * @type {Record<NewsletterSegment, string>}
 */
export const NEWSLETTER_SCHEDULE_ANCHORS = {
  financial_services: '2026-06-18', // The Financial Edge
  tech_ai_legal: '2026-06-25', // The Startup Solution
};

/** @type {Record<NewsletterSegment, string>} */
export const NEWSLETTER_SEGMENT_TITLES = {
  financial_services: 'The Financial Edge',
  tech_ai_legal: 'The Startup Solution',
};

const MS_PER_DAY = 86_400_000;

/**
 * @param {string} dateStr YYYY-MM-DD
 */
function utcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole calendar days from `startStr` to `endStr` (negative when end is before start).
 *
 * @param {string} startStr YYYY-MM-DD
 * @param {string} endStr YYYY-MM-DD
 */
export function daysBetween(startStr, endStr) {
  return Math.round((utcMs(endStr) - utcMs(startStr)) / MS_PER_DAY);
}

/**
 * Whether `segment` should assemble on `dateStr` (ET calendar date).
 *
 * @param {NewsletterSegment} segment
 * @param {string} dateStr YYYY-MM-DD
 */
export function isNewsletterAssembleDay(segment, dateStr) {
  const anchor = NEWSLETTER_SCHEDULE_ANCHORS[segment];
  if (!anchor) return false;
  const delta = daysBetween(anchor, dateStr);
  return delta >= 0 && delta % 14 === 0;
}

/**
 * Segments due for CMO assemble on `dateStr`.
 *
 * @param {string} dateStr YYYY-MM-DD
 * @returns {NewsletterSegment[]}
 */
export function segmentsDueOnDate(dateStr) {
  return NEWSLETTER_SEGMENTS.filter((segment) => isNewsletterAssembleDay(segment, dateStr));
}

/**
 * ET calendar date (YYYY-MM-DD) for a given instant.
 *
 * @param {Date} [when]
 */
export function etDateString(when = new Date()) {
  return when.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
