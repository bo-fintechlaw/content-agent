import crypto from 'crypto';

function generateKey() {
  return crypto.randomBytes(10).toString('hex');
}

/**
 * Naive markdown-ish -> Portable Text.
 * For MVP, we treat blank-line separated paragraphs as `normal` blocks.
 * @param {string} text
 * @returns {Array<{_type:'block',_key:string,style:'normal',markDefs:any[],children:Array}>}
 */
export function markdownToPortableText(text) {
  const raw = String(text ?? '');
  const paragraphs = raw
    .split(/\r?\n\r?\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks = paragraphs.length
    ? paragraphs
    : raw.trim()
      ? [raw.trim()]
      : [];

  return blocks.map((para) => ({
    _type: 'block',
    _key: generateKey(),
    style: 'normal',
    markDefs: [],
    children: [
      {
        _type: 'span',
        _key: generateKey(),
        text: normalizeWhitespace(para),
        marks: [],
      },
    ],
  }));
}

function normalizeWhitespace(s) {
  // Preserve intended newlines inside a paragraph less aggressively;
  // for now, collapse to single spaces.
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Converts Draft `blog_body` sections into Sanity `mainContent`.
 * @param {any} blogBody
 */
export function blogSectionsToMainContent(blogBody) {
  const sections = Array.isArray(blogBody)
    ? blogBody
    : typeof blogBody === 'string'
      ? [{ title: 'Section', body: blogBody, has_background: false }]
      : [];

  return sections.map((section) => {
    const title = String(section?.title ?? '');
    const bodyText = String(section?.body ?? section?.text ?? '');
    return {
      _type: 'pageComponentObject',
      _key: generateKey(),
      title,
      body: markdownToPortableText(bodyText),
      hasBackgroundColor: !!section?.has_background,
    };
  });
}

