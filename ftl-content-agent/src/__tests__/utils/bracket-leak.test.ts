import { describe, expect, it } from '@jest/globals';
import {
  buildBracketLeakRevisionInstruction,
  findBracketLeaks,
  findBracketLeaksInDraft,
} from '../../utils/bracket-leak.js';

describe('findBracketLeaks', () => {
  it('catches "[insert docket number]" placeholder', () => {
    const text = 'See OCC Docket [insert docket number], published March 2, 2026.';
    expect(findBracketLeaks(text)).toEqual(['[insert docket number]']);
  });

  it('catches [TBD] and [confirm date] case-insensitively', () => {
    const text = 'Effective [TBD]. Released [Confirm date].';
    const leaks = findBracketLeaks(text);
    expect(leaks).toContain('[TBD]');
    expect(leaks).toContain('[Confirm date]');
  });

  it('catches [Editor: ...] and [Note for editorial review: ...] notes', () => {
    const text = 'Foo [Editor: tighten this sentence] bar [Note for editorial review: verify] baz.';
    const leaks = findBracketLeaks(text);
    expect(leaks).toContain('[Editor: tighten this sentence]');
    expect(leaks).toContain('[Note for editorial review: verify]');
  });

  it('catches "[citation needed]" and "[add link]" variants', () => {
    expect(findBracketLeaks('Stat [citation needed].')).toContain('[citation needed]');
    expect(findBracketLeaks('See here [add link].')).toContain('[add link]');
  });

  it('does NOT flag Markdown link labels', () => {
    const text = 'See [the SEC release](https://sec.gov/x) for context.';
    expect(findBracketLeaks(text)).toEqual([]);
  });

  it('does NOT flag plain bracketed years or short labels without editorial keywords', () => {
    const text = 'In the period [2024-2026] the firm grew.';
    expect(findBracketLeaks(text)).toEqual([]);
  });

  it('deduplicates repeat leaks', () => {
    const text = '[insert citation] foo [insert citation] bar';
    expect(findBracketLeaks(text)).toEqual(['[insert citation]']);
  });

  it('handles empty / non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(findBracketLeaks(null)).toEqual([]);
    expect(findBracketLeaks('')).toEqual([]);
  });
});

describe('findBracketLeaksInDraft', () => {
  it('scans blog_title, blog_body, linkedin_post, and x_thread', () => {
    const draft = {
      blog_title: 'A title [TBD]',
      blog_seo_title: '',
      blog_seo_description: '',
      blog_body: [
        { title: 'Section 1', body: 'Body with [insert docket].' },
        { title: 'Section 2', body: 'Clean section with [a link](https://x).' },
      ],
      linkedin_post: 'Post text [Editor: cut]',
      x_post: 'Tweet text [pending]',
      x_thread: ['Tweet 1', 'Tweet 2 [confirm number]'],
    };
    const leaks = findBracketLeaksInDraft(draft);
    expect(leaks).toEqual(
      expect.arrayContaining([
        '[TBD]',
        '[insert docket]',
        '[Editor: cut]',
        '[pending]',
        '[confirm number]',
      ])
    );
    // Markdown link should not be in the leaks
    expect(leaks).not.toEqual(expect.arrayContaining(['[a link]']));
  });

  it('returns [] for a clean draft', () => {
    const draft = {
      blog_title: 'Clean Title',
      blog_body: [{ title: 'S1', body: 'No placeholders here.' }],
      linkedin_post: 'Post',
      x_post: 'Tweet',
      x_thread: [],
    };
    expect(findBracketLeaksInDraft(draft)).toEqual([]);
  });
});

describe('buildBracketLeakRevisionInstruction', () => {
  it('names every offending substring verbatim', () => {
    const out = buildBracketLeakRevisionInstruction(['[insert docket]', '[TBD]']);
    expect(out).toContain('[insert docket]');
    expect(out).toContain('[TBD]');
    expect(out).toContain('placeholder');
  });

  it('returns empty string when there are no leaks', () => {
    expect(buildBracketLeakRevisionInstruction([])).toBe('');
  });
});
