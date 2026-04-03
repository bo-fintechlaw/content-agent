import crypto from 'crypto';

function generateKey() {
  return crypto.randomBytes(10).toString('hex');
}

/**
 * Parse inline markdown formatting (bold, italic, links) into Portable Text spans + markDefs.
 * Handles: **bold**, *italic*, [text](url), and nested combinations.
 * @param {string} text
 * @returns {{ children: Array, markDefs: Array }}
 */
export function parseInlineFormatting(text) {
  const children = [];
  const markDefs = [];

  // Regex to match inline formatting tokens in order of precedence:
  // 1. Links: [text](url)
  // 2. Bold: **text**
  // 3. Italic: *text* (single asterisk, not preceded/followed by another asterisk)
  const tokenPattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;

  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      if (plain) {
        children.push({
          _type: 'span',
          _key: generateKey(),
          text: plain,
          marks: [],
        });
      }
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Link: [text](url)
      const linkKey = generateKey();
      markDefs.push({
        _type: 'link',
        _key: linkKey,
        href: match[2],
      });

      // Parse the link text for nested bold/italic
      const nested = parseInlineFormatting(match[1]);
      for (const child of nested.children) {
        children.push({
          ...child,
          _key: generateKey(),
          marks: [...child.marks, linkKey],
        });
      }
      // Nested markDefs from inside link text
      markDefs.push(...nested.markDefs);
    } else if (match[3] !== undefined) {
      // Bold: **text**
      // Parse inside for nested formatting (links inside bold)
      const nested = parseInlineFormatting(match[3]);
      for (const child of nested.children) {
        children.push({
          ...child,
          _key: generateKey(),
          marks: ['strong', ...child.marks],
        });
      }
      markDefs.push(...nested.markDefs);
    } else if (match[4] !== undefined) {
      // Italic: *text*
      children.push({
        _type: 'span',
        _key: generateKey(),
        text: match[4],
        marks: ['em'],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text after last match
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) {
      children.push({
        _type: 'span',
        _key: generateKey(),
        text: remaining,
        marks: [],
      });
    }
  }

  // If no formatting was found, return the whole text as a single plain span
  if (children.length === 0) {
    children.push({
      _type: 'span',
      _key: generateKey(),
      text,
      marks: [],
    });
  }

  return { children, markDefs };
}

/**
 * Detect whether a chunk of text (lines between double-newlines) is a list.
 * Returns { type: 'bullet' | 'number' | null, items: string[] }
 */
function detectList(lines) {
  const bulletPattern = /^[-*]\s+/;
  const numberPattern = /^\d+\.\s+/;

  const allBullet = lines.length > 0 && lines.every((l) => bulletPattern.test(l));
  if (allBullet) {
    return {
      type: 'bullet',
      items: lines.map((l) => l.replace(bulletPattern, '')),
    };
  }

  const allNumber = lines.length > 0 && lines.every((l) => numberPattern.test(l));
  if (allNumber) {
    return {
      type: 'number',
      items: lines.map((l) => l.replace(numberPattern, '')),
    };
  }

  return { type: null, items: [] };
}

/**
 * Convert markdown-formatted text to Portable Text blocks.
 * Supports: bold, italic, links, bulleted lists, numbered lists.
 * @param {string} text
 * @returns {Array<object>} Portable Text blocks
 */
export function markdownToPortableText(text) {
  const raw = String(text ?? '');
  const chunks = raw
    .split(/\r?\n\r?\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const paragraphs = chunks.length
    ? chunks
    : raw.trim()
      ? [raw.trim()]
      : [];

  const blocks = [];

  for (const para of paragraphs) {
    const lines = para.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const list = detectList(lines);

    if (list.type) {
      // Each list item becomes its own block
      for (const item of list.items) {
        const { children, markDefs } = parseInlineFormatting(item);
        blocks.push({
          _type: 'block',
          _key: generateKey(),
          style: 'normal',
          listItem: list.type,
          level: 1,
          markDefs,
          children,
        });
      }
    } else {
      // Regular paragraph — collapse internal newlines to spaces
      const normalized = lines.join(' ');
      const { children, markDefs } = parseInlineFormatting(normalized);
      blocks.push({
        _type: 'block',
        _key: generateKey(),
        style: 'normal',
        markDefs,
        children,
      });
    }
  }

  return blocks;
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
