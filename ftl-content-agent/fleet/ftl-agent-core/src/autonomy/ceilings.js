/** Kinds that never graduate past human approve (attorney advertising). */
export const CEILING_APPROVE = new Set([
  'newsletter_issue_draft',
  'newsletter_social_post',
  'linkedin_draft',
  'trackb_draft',
]);

/** Kinds that must never auto-execute. */
export const NEVER_AUTO = new Set([
  'newsletter_issue_draft',
  'newsletter_social_post',
  'linkedin_draft',
  'trackb_draft',
]);

const ORDER = { shadow: 0, approve: 1, auto: 2 };

/**
 * @param {string} kind
 * @param {'shadow'|'approve'|'auto'} dbLevel
 * @returns {'shadow'|'approve'|'auto'}
 */
export function resolveAutonomyLevel(kind, dbLevel) {
  let level = dbLevel;
  if (NEVER_AUTO.has(kind) && level === 'auto') {
    level = 'approve';
  }
  if (CEILING_APPROVE.has(kind) && ORDER[level] > ORDER.approve) {
    level = 'approve';
  }
  return level;
}
