import crypto from 'crypto';

function generateKey() {
  return crypto.randomBytes(10).toString('hex');
}

/**
 * **bold** only (no [links](...)).
 * @param {string} text
 * @returns {Array<{_type:'span',_key:string,text:string,marks:string[]}>}
 */
function childrenFromInlineBoldOnly(text) {
  const t = String(text ?? '');
  const re = /\*\*([^*]+)\*\*/g;
  const children = [];
  let last = 0;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) {
      const plain = t.slice(last, m.index);
      if (plain) {
        children.push({
          _type: 'span',
          _key: generateKey(),
          text: plain,
          marks: [],
        });
      }
    }
    children.push({
      _type: 'span',
      _key: generateKey(),
      text: m[1],
      marks: ['strong'],
    });
    last = m.index + m[0].length;
  }
  if (last < t.length) {
    const plain = t.slice(last);
    if (plain) {
      children.push({
        _type: 'span',
        _key: generateKey(),
        text: plain,
        marks: [],
      });
    }
  }
  if (children.length === 0) {
    children.push({ _type: 'span', _key: generateKey(), text: t || '', marks: [] });
  }
  return children;
}

/**
 * [label](https://url) and **bold** (order: ** before links; links before plain runs).
 * @param {string} text
 * @returns {{ children: Array, markDefs: Array }}
 */
export function childrenFromInlineText(text) {
  const t = String(text ?? '');
  const markDefs = [];
  const outChildren = [];

  function addLinkDef(href) {
    const k = generateKey();
    markDefs.push({ _key: k, _type: 'link', href: String(href).trim() });
    return k;
  }

  function tryMdLink(s, start) {
    if (s[start] !== '[') return null;
    const closeB = s.indexOf(']', start + 1);
    if (closeB < 0 || s[closeB + 1] !== '(') return null;
    const closeP = s.indexOf(')', closeB + 2);
    if (closeP < 0) return null;
    const label = s.slice(start + 1, closeB);
    const href = s.slice(closeB + 2, closeP);
    if (!/^https?:\/\//i.test(href)) return null;
    return { label, href, end: closeP + 1 };
  }

  let i = 0;
  while (i < t.length) {
    if (t.slice(i, i + 2) === '**') {
      const end = t.indexOf('**', i + 2);
      if (end < 0) {
        outChildren.push(...childrenFromInlineBoldOnly(t.slice(i)));
        break;
      }
      const mid = t.slice(i + 2, end);
      if (mid) {
        outChildren.push({
          _type: 'span',
          _key: generateKey(),
          text: mid,
          marks: ['strong'],
        });
      }
      i = end + 2;
      continue;
    }

    if (t[i] === '[') {
      const atL = tryMdLink(t, i);
      if (atL) {
        const k = addLinkDef(atL.href);
        for (const c of childrenFromInlineBoldOnly(atL.label)) {
          c._key = generateKey();
          c.marks = c.marks?.length ? [...c.marks, k] : [k];
          outChildren.push(c);
        }
        i = atL.end;
        continue;
      }
      outChildren.push(...childrenFromInlineBoldOnly('['));
      i += 1;
      continue;
    }

    const nextB = t.indexOf('**', i + 1);
    const nextL = t.indexOf('[', i);
    const nextSpecial = [nextB, nextL].filter((n) => n > i);
    const stop = nextSpecial.length ? Math.min(...nextSpecial) : t.length;
    const run = t.slice(i, stop);
    if (run) {
      outChildren.push(...childrenFromInlineBoldOnly(run));
    }
    if (stop >= t.length) break;
    i = stop;
  }

  if (outChildren.length === 0) {
    return {
      children: [{ _type: 'span', _key: generateKey(), text: '', marks: [] }],
      markDefs,
    };
  }
  return { children: outChildren, markDefs };
}

function blockNode(style, children, markDefs = []) {
  return {
    _type: 'block',
    _key: generateKey(),
    style,
    markDefs: markDefs || [],
    children,
  };
}

function listBlock(listItem, children, markDefs = []) {
  return {
    _type: 'block',
    _key: generateKey(),
    style: 'normal',
    listItem,
    level: 1,
    markDefs: markDefs || [],
    children,
  };
}

/**
 * @param {string} text
 * @returns {Array}
 */
function inlineLineToBlock(style, text) {
  const { children, markDefs } = childrenFromInlineText(String(text).trim());
  return blockNode(style, children, markDefs);
}

/**
 * Line-oriented markdown subset → Portable Text blocks (Sanity / @portabletext).
 * Supports: blank-line paragraph breaks, ##/### subheads, - / * / • bullets,
 * 1. numbered items, **bold**, and [label](https://url) links in prose and lists.
 * @param {string} text
 * @returns {Array}
 */
export function markdownToPortableText(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];

  const lines = raw.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  const para = [];

  function flushParagraph() {
    if (!para.length) return;
    const joined = para.join(' ').replace(/\s+/g, ' ').trim();
    para.length = 0;
    if (!joined) return;
    const { children, markDefs } = childrenFromInlineText(joined);
    blocks.push(blockNode('normal', children, markDefs));
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      blocks.push(inlineLineToBlock('h3', trimmed.slice(4)));
      i += 1;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      blocks.push(inlineLineToBlock('h2', trimmed.slice(3)));
      i += 1;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      const firstItem = bulletMatch[1].trim();
      i += 1;
      const items = [firstItem];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === '') break;
        const bm = t.match(/^[-*•]\s+(.+)$/);
        if (!bm) break;
        items.push(bm[1].trim());
        i += 1;
      }
      for (const item of items) {
        const { children, markDefs } = childrenFromInlineText(item);
        blocks.push(listBlock('bullet', children, markDefs));
      }
      continue;
    }

    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      flushParagraph();
      const firstItem = numMatch[2].trim();
      i += 1;
      const items = [firstItem];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === '') break;
        const nm = t.match(/^(\d+)\.\s+(.+)$/);
        if (!nm) break;
        items.push(nm[2].trim());
        i += 1;
      }
      for (const item of items) {
        const { children, markDefs } = childrenFromInlineText(item);
        blocks.push(listBlock('number', children, markDefs));
      }
      continue;
    }

    para.push(trimmed);
    i += 1;
  }

  flushParagraph();
  return blocks;
}

/**
 * @param {string} bodyText
 * @param {string} sectionTitle
 * @returns {boolean}
 */
function bodyAlreadyOpensWithSectionHeading(bodyText, sectionTitle) {
  const st = String(sectionTitle).trim();
  if (!st) return true;
  const b = String(bodyText).trim();
  if (!b) return false;
  const m = b.match(/^(#+)\s+(.+)$/m);
  if (m) {
    return m[2].trim().toLowerCase() === st.toLowerCase();
  }
  return false;
}

/**
 * Converts Draft `blog_body` sections into Sanity `mainContent`.
 * Renders each section "title" as a visible H2 in body unless the first heading in body is already the same text.
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
    const contentBlocks = markdownToPortableText(bodyText);
    let body = contentBlocks;
    if (title.trim() && !bodyAlreadyOpensWithSectionHeading(bodyText, title)) {
      const { children, markDefs } = childrenFromInlineText(title);
      const titleBlock = blockNode('h2', children, markDefs);
      body = [titleBlock, ...contentBlocks];
    }
    return {
      _type: 'pageComponentObject',
      _key: generateKey(),
      title,
      body,
      hasBackgroundColor: !!section?.has_background,
    };
  });
}
