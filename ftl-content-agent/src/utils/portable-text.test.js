import { describe, it, expect } from 'vitest';
import { markdownToPortableText, parseInlineFormatting, blogSectionsToMainContent } from './portable-text.js';

// ─── parseInlineFormatting ──────────────────────────────────────────────

describe('parseInlineFormatting', () => {
  it('returns a single plain span for unformatted text', () => {
    const { children, markDefs } = parseInlineFormatting('plain text');
    expect(children).toHaveLength(1);
    expect(children[0].text).toBe('plain text');
    expect(children[0].marks).toEqual([]);
    expect(markDefs).toHaveLength(0);
  });

  it('parses bold text (**...**)', () => {
    const { children } = parseInlineFormatting('**bold** text');
    expect(children).toHaveLength(2);
    expect(children[0].text).toBe('bold');
    expect(children[0].marks).toContain('strong');
    expect(children[1].text).toBe(' text');
    expect(children[1].marks).toEqual([]);
  });

  it('parses italic text (*...*)', () => {
    const { children } = parseInlineFormatting('*italic* word');
    expect(children).toHaveLength(2);
    expect(children[0].text).toBe('italic');
    expect(children[0].marks).toContain('em');
  });

  it('parses links [text](url)', () => {
    const { children, markDefs } = parseInlineFormatting('[SEC](https://sec.gov) issued');
    expect(markDefs).toHaveLength(1);
    expect(markDefs[0]._type).toBe('link');
    expect(markDefs[0].href).toBe('https://sec.gov');
    expect(children).toHaveLength(2);
    expect(children[0].text).toBe('SEC');
    expect(children[0].marks).toContain(markDefs[0]._key);
    expect(children[1].text).toBe(' issued');
  });

  it('parses bold link (**[text](url)**)', () => {
    const { children, markDefs } = parseInlineFormatting('**[Bold Link](https://example.com)** after');
    expect(children).toHaveLength(2);
    expect(children[0].marks).toContain('strong');
    const linkDef = markDefs.find((d) => d._type === 'link');
    expect(linkDef).toBeTruthy();
    expect(children[0].marks).toContain(linkDef._key);
  });

  it('parses link inside bold (**See [report](url) for details**)', () => {
    const { children, markDefs } = parseInlineFormatting('**See [this report](https://sec.gov) for details**');
    const linkDef = markDefs.find((d) => d._type === 'link');
    expect(linkDef).toBeTruthy();
    const linkSpan = children.find((c) => c.text === 'this report');
    expect(linkSpan.marks).toContain('strong');
    expect(linkSpan.marks).toContain(linkDef._key);
  });

  it('handles mixed bold, link, and plain text', () => {
    const { children } = parseInlineFormatting('**Bold** and [link](url) in text');
    expect(children).toHaveLength(4);
    expect(children[0].marks).toContain('strong');
    expect(children[1].text).toBe(' and ');
    expect(children[1].marks).toEqual([]);
  });

  it('does not create italic for spaced asterisks (e.g. 3 * 4 = 12)', () => {
    const { children } = parseInlineFormatting('Use 3 * 4 = 12 for the calculation');
    // Should be a single plain span — the spaced asterisks should not match italic
    expect(children).toHaveLength(1);
    expect(children[0].marks).toEqual([]);
  });
});

// ─── markdownToPortableText ─────────────────────────────────────────────

describe('markdownToPortableText', () => {
  it('creates a single normal block for a plain paragraph', () => {
    const blocks = markdownToPortableText('Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].style).toBe('normal');
    expect(blocks[0].listItem).toBeUndefined();
  });

  it('creates bullet list blocks for - prefixed lines', () => {
    const blocks = markdownToPortableText('- item one\n- item two\n- item three');
    expect(blocks).toHaveLength(3);
    expect(blocks[0].listItem).toBe('bullet');
    expect(blocks[0].level).toBe(1);
    expect(blocks[0].children[0].text).toBe('item one');
    expect(blocks[2].children[0].text).toBe('item three');
  });

  it('creates numbered list blocks for digit-dot prefixed lines', () => {
    const blocks = markdownToPortableText('1. first\n2. second\n3. third');
    expect(blocks).toHaveLength(3);
    expect(blocks[0].listItem).toBe('number');
    expect(blocks[0].level).toBe(1);
    expect(blocks[0].children[0].text).toBe('first');
  });

  it('handles mixed paragraphs and lists', () => {
    const blocks = markdownToPortableText('Paragraph one.\n\n- bullet a\n- bullet b\n\nParagraph two.');
    expect(blocks).toHaveLength(4);
    expect(blocks[0].listItem).toBeUndefined();
    expect(blocks[1].listItem).toBe('bullet');
    expect(blocks[2].listItem).toBe('bullet');
    expect(blocks[3].listItem).toBeUndefined();
  });

  it('preserves inline formatting in list items', () => {
    const blocks = markdownToPortableText('- **Bold item** with [link](https://example.com)');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].listItem).toBe('bullet');
    expect(blocks[0].children[0].marks).toContain('strong');
    expect(blocks[0].markDefs).toHaveLength(1);
  });

  it('handles bold-lead takeaway pattern', () => {
    const blocks = markdownToPortableText(
      '**Key takeaway.** The SEC [issued a fine](https://sec.gov/fine) of $150,000.'
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children[0].marks).toContain('strong');
    expect(blocks[0].markDefs).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(markdownToPortableText('')).toHaveLength(0);
  });

  it('returns empty array for null input', () => {
    expect(markdownToPortableText(null)).toHaveLength(0);
  });

  it('returns empty array for undefined input', () => {
    expect(markdownToPortableText(undefined)).toHaveLength(0);
  });

  it('handles * prefix bullet lists', () => {
    const blocks = markdownToPortableText('* item one\n* item two');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].listItem).toBe('bullet');
  });

  it('collapses internal newlines in regular paragraphs', () => {
    const blocks = markdownToPortableText('Line one\nLine two\nLine three');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children[0].text).toBe('Line one Line two Line three');
  });
});

// ─── blogSectionsToMainContent ──────────────────────────────────────────

describe('blogSectionsToMainContent', () => {
  it('converts blog_body sections to pageComponentObjects', () => {
    const blogBody = [
      { title: 'Section One', body: '**Bold** paragraph.', has_background: false },
      { title: 'Key Takeaways', body: '- takeaway one\n- takeaway two', has_background: true },
    ];
    const result = blogSectionsToMainContent(blogBody);
    expect(result).toHaveLength(2);

    // Section one
    expect(result[0]._type).toBe('pageComponentObject');
    expect(result[0].title).toBe('Section One');
    expect(result[0].hasBackgroundColor).toBe(false);
    expect(result[0].body[0].children[0].marks).toContain('strong');

    // Key takeaways
    expect(result[1].title).toBe('Key Takeaways');
    expect(result[1].hasBackgroundColor).toBe(true);
    expect(result[1].body).toHaveLength(2);
    expect(result[1].body[0].listItem).toBe('bullet');
  });

  it('handles string input as a single section', () => {
    const result = blogSectionsToMainContent('Plain text body');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Section');
  });

  it('handles empty/invalid input', () => {
    expect(blogSectionsToMainContent(null)).toEqual([]);
    expect(blogSectionsToMainContent(undefined)).toEqual([]);
    expect(blogSectionsToMainContent(42)).toEqual([]);
  });
});
