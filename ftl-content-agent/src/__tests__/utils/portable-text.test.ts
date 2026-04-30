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

  it('joins single newlines into one paragraph (soft wrap)', () => {
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

  it('parses **bold** into strong spans', () => {
    const blocks = markdownToPortableText('This is **important** here.');
    expect(blocks[0].style).toBe('normal');
    expect(
      (blocks[0].children as any[]).some((c) => c.marks?.includes('strong') && c.text === 'important')
    ).toBe(true);
  });

  it('parses multiple **bold** segments in one block', () => {
    const blocks = markdownToPortableText('**First** and **second** bold.');
    const strongTexts = (blocks[0].children as any[]).filter((c) => c.marks?.includes('strong'));
    expect(strongTexts.map((c) => c.text)).toEqual(['First', 'second']);
  });

  it('parses ## and ### as h2 and h3 blocks', () => {
    const blocks = markdownToPortableText('Intro line.\n\n## Section title\n\nMore text.\n\n### Sub bit');
    const styles = blocks.map((b: any) => b.style);
    expect(styles).toContain('h2');
    expect(styles).toContain('h3');
  });

  it('parses bullet list lines as listItem bullet blocks', () => {
    const text = 'Intro.\n\n- first item\n- second **bold** item';
    const blocks = markdownToPortableText(text);
    const bullets = blocks.filter((b: any) => b.listItem === 'bullet');
    expect(bullets.length).toBe(2);
    expect(
      (bullets[1].children as any[]).some(
        (c) => c.marks?.includes('strong') && c.text === 'bold'
      )
    ).toBe(true);
  });

  it('parses numbered lists', () => {
    const blocks = markdownToPortableText('1. one\n2. two\n\nDone.');
    const nums = blocks.filter((b: any) => b.listItem === 'number');
    expect(nums.length).toBe(2);
  });

  it('bold-lead takeaway uses strong on first span', () => {
    const blocks = markdownToPortableText(
      '**Advisory agreement language carries real regulatory risk.** The enforcement action followed.'
    );
    expect((blocks[0].children[0] as any).marks?.includes('strong')).toBe(true);
  });

  it('parses [label](https://url) with link markDefs on the block', () => {
    const blocks = markdownToPortableText('Visit [our site](https://fintechlaw.ai) today.');
    const b0 = blocks[0] as any;
    const href = b0.markDefs?.find((d: any) => d._type === 'link')?.href;
    expect(href).toBe('https://fintechlaw.ai');
    const linkSpan = (b0.children as any[]).find(
      (c) => c.marks?.length && c.text === 'our site'
    );
    expect(linkSpan).toBeDefined();
  });
});

describe('blogSectionsToMainContent', () => {
  it('converts blog_body sections to pageComponentObjects and prepends section title as h2', () => {
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
    expect(result[0].body[0].style).toBe('h2');
    expect((result[0].body[0].children as any[]).map((c) => c.text).join('')).toBe('Introduction');
    expect(result[0].body[1].style).toBe('normal');
  });

  it('handles string input as single section with default title as h2', () => {
    const result = blogSectionsToMainContent('Just a plain string.');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Section');
    expect(result[0].body[0].style).toBe('h2');
    expect(result[0].body[1].children[0].text).toBe('Just a plain string.');
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
    const normalBlock = (result[0].body as any[]).find((b) => b.style === 'normal');
    expect(normalBlock?.children[0].text).toBe('Content via text field.');
  });

  it('generates unique keys per section', () => {
    const sections = [
      { title: 'A', body: 'Text A.' },
      { title: 'B', body: 'Text B.' },
    ];
    const result = blogSectionsToMainContent(sections);
    expect(result[0]._key).not.toBe(result[1]._key);
  });

  it('does not duplicate h2 if body already opens with the same section heading', () => {
    const sections = [
      { title: 'The Topic', body: '## The Topic\n\nFirst paragraph of body only.' },
    ];
    const result = blogSectionsToMainContent(sections);
    const h2s = (result[0].body as any[]).filter((b) => b.style === 'h2');
    expect(h2s).toHaveLength(1);
    expect(
      h2s[0].children
        .map((c: any) => c.text)
        .join('')
        .includes('The Topic')
    ).toBe(true);
  });
});
