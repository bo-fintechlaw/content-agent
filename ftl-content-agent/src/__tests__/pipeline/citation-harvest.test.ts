import { describe, expect, it } from '@jest/globals';
const { extractHttpUrlsFromDraft } = await import('../../pipeline/citation-harvest.js');

describe('extractHttpUrlsFromDraft', () => {
  it('collects unique https URLs from body and social text', () => {
    const urls = extractHttpUrlsFromDraft({
      blog_title: 'T',
      blog_body: [
        { title: 'A', body: 'See [SEC](https://www.sec.gov/news) and also https://example.com/path. ', has_background: false },
      ],
      linkedin_post: 'Link https://linkedin.com/x.',
      x_post: 'Nope',
      x_thread: [],
    });
    expect(urls).toContain('https://www.sec.gov/news');
    expect(urls).toContain('https://example.com/path');
    expect(urls).toContain('https://linkedin.com/x');
    expect(new Set(urls).size).toBe(urls.length);
  });
});
