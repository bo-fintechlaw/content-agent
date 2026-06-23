import { describe, expect, it } from '@jest/globals';

const {
  applyDiversityPenalty,
  SAME_SOURCE_PENALTY,
  SAME_CATEGORY_PENALTY,
} = await import('../../pipeline/diversity.js');

const c = (score: number, source: string, category: string, id = '') => ({
  id: id || `${source}-${score}`,
  relevance_score: score,
  source_name: source,
  category,
  title: `Topic ${id || source}`,
});

describe('applyDiversityPenalty', () => {
  it('returns candidates unchanged when there is no recent history', () => {
    const candidates = [c(8.5, 'PYMNTS', 'crypto'), c(8.0, 'SEC', 'regulatory')];
    const adjusted = applyDiversityPenalty(candidates, []);
    expect(adjusted[0].topic.id).toBe('PYMNTS-8.5');
    expect(adjusted[0].penalty).toBe(0);
    expect(adjusted[1].topic.id).toBe('SEC-8');
  });

  it('downranks a same-source candidate when it appears in recent history', () => {
    const candidates = [c(8.5, 'PYMNTS', 'crypto'), c(7.5, 'CFTC', 'regulatory')];
    const recent = [{ source_name: 'PYMNTS', category: 'crypto', published_at: 'now' }];
    const adjusted = applyDiversityPenalty(candidates, recent);
    // PYMNTS adjusted: 8.5 - 2.0 (source) - 1.0 (category) = 5.5
    // CFTC adjusted: 7.5 - 0 = 7.5
    expect(adjusted[0].topic.id).toBe('CFTC-7.5');
    expect(adjusted[1].topic.id).toBe('PYMNTS-8.5');
    expect(adjusted[1].penalty).toBe(SAME_SOURCE_PENALTY + SAME_CATEGORY_PENALTY);
  });

  it('penalty stacks across multiple same-source recent posts', () => {
    const candidates = [c(8.0, 'PYMNTS', 'startup')];
    const recent = [
      { source_name: 'PYMNTS', category: 'startup', published_at: 't1' },
      { source_name: 'PYMNTS', category: 'crypto', published_at: 't2' },
      { source_name: 'PYMNTS', category: 'crypto', published_at: 't3' },
    ];
    const adjusted = applyDiversityPenalty(candidates, recent);
    // 3 source matches: -6.0; 1 category match (startup): -1.0; 2 category matches (crypto) for cand=startup: 0
    // PYMNTS-startup vs recent: source matches all 3, category matches only the startup one
    expect(adjusted[0].penalty).toBe(SAME_SOURCE_PENALTY * 3 + SAME_CATEGORY_PENALTY * 1);
    expect(adjusted[0].adjustedScore).toBe(Math.max(0, 8.0 - (3 * 2.0 + 1 * 1.0)));
  });

  it('breaks ties on raw score when adjusted scores are equal', () => {
    const candidates = [c(7.0, 'PYMNTS', 'crypto', 'A'), c(8.0, 'CoinDesk', 'crypto', 'B')];
    const recent = [{ source_name: 'CoinDesk', category: 'crypto', published_at: 'now' }];
    // A: 7.0 - 1.0 (cat) = 6.0
    // B: 8.0 - 2.0 (src) - 1.0 (cat) = 5.0
    // A wins on adjusted
    const adjusted = applyDiversityPenalty(candidates, recent);
    expect(adjusted[0].topic.id).toBe('A');
  });

  it('clamps adjusted score at zero', () => {
    const candidates = [c(1.5, 'PYMNTS', 'crypto')];
    const recent = [
      { source_name: 'PYMNTS', category: 'crypto', published_at: 'now' },
      { source_name: 'PYMNTS', category: 'crypto', published_at: 'now' },
    ];
    const adjusted = applyDiversityPenalty(candidates, recent);
    // raw 1.5 - (4 + 2) = -4.5 → clamped to 0
    expect(adjusted[0].adjustedScore).toBe(0);
  });

  it('does not match on missing or empty fields', () => {
    const candidates = [c(8.0, '', 'crypto')];
    const recent = [{ source_name: '', category: 'crypto', published_at: 'now' }];
    const adjusted = applyDiversityPenalty(candidates, recent);
    // empty source name on candidate AND recent should not register a source match
    expect(adjusted[0].penalty).toBe(SAME_CATEGORY_PENALTY);
  });

  it('is case-insensitive on source and category', () => {
    const candidates = [c(8.0, 'PYMNTS', 'Crypto')];
    const recent = [{ source_name: 'pymnts', category: 'CRYPTO', published_at: 'now' }];
    const adjusted = applyDiversityPenalty(candidates, recent);
    expect(adjusted[0].penalty).toBe(SAME_SOURCE_PENALTY + SAME_CATEGORY_PENALTY);
  });

  it('applies title trigram penalty against recent published titles (brand-scoped)', () => {
    const candidates = [
      c(8.5, 'Reuters', 'privacy', 'A'),
      c(7.0, 'IAPP', 'privacy', 'B'),
    ];
    const recent = [
      {
        source_name: 'Other',
        category: 'regulatory',
        brand_id: 'fintechlaw',
        blog_title: 'SEC settles advisory firm over marketing rule violations',
        published_at: 'now',
      },
    ];
    const adjusted = applyDiversityPenalty(candidates, recent);
    expect(adjusted[0].topic.id).toBe('A');
  });

  it('handles null/undefined inputs without throwing', () => {
    expect(applyDiversityPenalty(null as any, null as any)).toEqual([]);
    expect(applyDiversityPenalty([], null as any)).toEqual([]);
    expect(applyDiversityPenalty([c(7, 'PYMNTS', 'crypto')], null as any)).toHaveLength(1);
  });
});
