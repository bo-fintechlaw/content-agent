import { resolveAutonomyLevel, NEVER_AUTO, CEILING_APPROVE } from '../src/autonomy/ceilings.js';

describe('autonomy ceilings', () => {
  it('clamps newsletter_issue_draft auto to approve', () => {
    expect(resolveAutonomyLevel('newsletter_issue_draft', 'auto')).toBe('approve');
  });

  it('keeps shadow for newsletter_issue_draft', () => {
    expect(resolveAutonomyLevel('newsletter_issue_draft', 'shadow')).toBe('shadow');
  });

  it('lists newsletter kinds in NEVER_AUTO', () => {
    expect(NEVER_AUTO.has('newsletter_issue_draft')).toBe(true);
    expect(CEILING_APPROVE.has('newsletter_issue_draft')).toBe(true);
  });
});
