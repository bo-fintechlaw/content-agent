import { describe, expect, it } from '@jest/globals';

const { markdownToPortableText, blogSectionsToMainContent } = await import(
  '../../utils/portable-text.js'
);

describe('markdownToPortableText', () => {
  it('converts a single paragraph to one block', () => {
    const blocks = markdownToPortableText('Hello world.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]._type).toBe('block');
    expect(blocks[0].style).toBe('normal');
    expect(blocks[0].children[0].text).toBe('Hello world.');
  });

  it('splits on blank lines into multiple blocks', () => {
    const blocks = markdownToPortableText('Paragraph one.\n\nParagraph two.\n\nParagraph three.');
    expect(blocks).toHaveLength(3);
    expect(blocks[0].children[0].text).toBe('Paragraph one.');
    expect(blocks[1].children[0].text).toBe('Paragraph two.');
    expect(blocks[2].children[0].text).toBe('Paragraph three.');
  });

  it('handles Windows line endings (CRLF)', () => {
    const blocks = markdownToPortableText('First.\r\n\r\nSecond.');
    expect(blocks).toHaveLength(2);
  });

  it('collapses internal whitespace', () => {
    const blocks = markdownToPortableText('Hello   world\n  continued.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children[0].text).toBe('Hello world continued.');
  });

  it('returns empty array for null/undefined input', () => {
    expect(markdownToPortableText(null)).toEqual([]);
    expect(markdownToPortableText(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(markdownToPortableText('')).toEqual([]);
  });

  it('generates unique _key values', () => {
    const blocks = markdownToPortableText('A.\n\nB.\n\nC.');
    const keys = blocks.map((b: any) => b._key);
    expect(new Set(keys).size).toBe(3);
  });

  it('includes markDefs as empty array for plain text', () => {
    const blocks = markdownToPortableText('Text.');
    expect(blocks[0].markDefs).toEqual([]);
  });

  // MVP: markdownToPortableText is paragraph-split + whitespace only; inline ** / * / links stay literal.
  it('keeps inline markdown markers as literal text (MVP)', () => {
    const blocks = markdownToPortableText('This is **important** content.');
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children[0].text).toBe('This is **important** content.');
    expect(blocks[0].children[0].marks).toEqual([]);
  });

  it('preserves *emphasis* syntax as literal until inline parsing exists', () => {
    const blocks = markdownToPortableText('This is *emphasized* text.');
    expect(blocks[0].children[0].text).toBe('This is *emphasized* text.');
  });

  it('preserves [link](url) as literal until inline parsing exists', () => {
    const blocks = markdownToPortableText('Visit [our site](https://fintechlaw.ai) today.');
    expect(blocks[0].children[0].text).toBe(
      'Visit [our site](https://fintechlaw.ai) today.'
    );
  });

  it('keeps multiple ** segments in one span (MVP)', () => {
    const blocks = markdownToPortableText('**First** and **second** bold.');
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children[0].text).toBe('**First** and **second** bold.');
  });

  it('keeps bold-lead takeaway as one literal span (MVP)', () => {
    const blocks = markdownToPortableText(
      '**Advisory agreement language carries real regulatory risk.** The FamilyWealth enforcement action resulted in $150,000 in penalties.'
    );
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children[0].text).toContain('**Advisory agreement');
  });

  it('preserves plain text with no marks when no formatting present', () => {
    const blocks = markdownToPortableText('Just plain text here.');
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children[0].text).toBe('Just plain text here.');
    expect(blocks[0].children[0].marks).toEqual([]);
    expect(blocks[0].markDefs).toEqual([]);
  });
});

describe('blogSectionsToMainContent', () => {
  it('converts blog_body sections to pageComponentObjects', () => {
    const sections = [
      { title: 'Introduction', body: 'Opening text.', has_background: false },
      { title: 'Analysis', body: 'Detailed analysis.', has_background: true },
    ];
    const result = blogSectionsToMainContent(sections);
    expect(result).toHaveLength(2);
    expect(result[0]._type).toBe('pageComponentObject');
    expect(result[0].title).toBe('Introduction');
    expect(result[0].hasBackgroundColor).toBe(false);
    expect(result[1].hasBackgroundColor).toBe(true);
    expect(result[0].body).toBeInstanceOf(Array);
    expect(result[0].body[0]._type).toBe('block');
  });

  it('handles string input as single section', () => {
    const result = blogSectionsToMainContent('Just a plain string.');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Section');
    expect(result[0].body[0].children[0].text).toBe('Just a plain string.');
  });

  it('handles non-array non-string input as empty', () => {
    const result = blogSectionsToMainContent(null);
    expect(result).toEqual([]);
  });

  it('handles sections with missing fields gracefully', () => {
    const sections = [{ title: undefined, body: undefined }];
    const result = blogSectionsToMainContent(sections);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('');
  });

  it('uses text field as fallback for body', () => {
    const sections = [{ title: 'Test', text: 'Content via text field.' }];
    const result = blogSectionsToMainContent(sections);
    expect(result[0].body[0].children[0].text).toBe('Content via text field.');
  });

  it('generates unique keys per section', () => {
    const sections = [
      { title: 'A', body: 'Text A.' },
      { title: 'B', body: 'Text B.' },
    ];
    const result = blogSectionsToMainContent(sections);
    expect(result[0]._key).not.toBe(result[1]._key);
  });
});
