import { markdownToPortableText, parseInlineFormatting } from './portable-text.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// --- parseInlineFormatting tests ---

{
  const { children, markDefs } = parseInlineFormatting('plain text');
  assert(children.length === 1, 'plain text: one span');
  assert(children[0].text === 'plain text', 'plain text: correct text');
  assert(children[0].marks.length === 0, 'plain text: no marks');
  assert(markDefs.length === 0, 'plain text: no markDefs');
}

{
  const { children } = parseInlineFormatting('**bold** text');
  assert(children.length === 2, 'bold: two spans');
  assert(children[0].text === 'bold', 'bold: correct bold text');
  assert(children[0].marks.includes('strong'), 'bold: has strong mark');
  assert(children[1].text === ' text', 'bold: trailing plain text');
  assert(children[1].marks.length === 0, 'bold: trailing has no marks');
}

{
  const { children } = parseInlineFormatting('*italic* word');
  assert(children.length === 2, 'italic: two spans');
  assert(children[0].text === 'italic', 'italic: correct text');
  assert(children[0].marks.includes('em'), 'italic: has em mark');
}

{
  const { children, markDefs } = parseInlineFormatting('[SEC](https://sec.gov) issued');
  assert(markDefs.length === 1, 'link: one markDef');
  assert(markDefs[0]._type === 'link', 'link: markDef type is link');
  assert(markDefs[0].href === 'https://sec.gov', 'link: correct href');
  assert(children.length === 2, 'link: two spans');
  assert(children[0].text === 'SEC', 'link: correct link text');
  assert(children[0].marks.includes(markDefs[0]._key), 'link: span references markDef key');
  assert(children[1].text === ' issued', 'link: trailing text');
}

{
  const { children, markDefs } = parseInlineFormatting('**[Bold Link](https://example.com)** after');
  assert(children.length === 2, 'bold link: two spans');
  assert(children[0].marks.includes('strong'), 'bold link: has strong');
  assert(markDefs.length >= 1, 'bold link: has markDef');
  const linkDef = markDefs.find((d) => d._type === 'link');
  assert(linkDef, 'bold link: has link markDef');
  assert(children[0].marks.includes(linkDef._key), 'bold link: span has link mark');
}

{
  const { children } = parseInlineFormatting('**Bold** and [link](url) in text');
  assert(children.length === 4, 'mixed: four spans (bold, " and ", link, " in text")');
  assert(children[0].marks.includes('strong'), 'mixed: first span is bold');
  assert(children[1].text === ' and ', 'mixed: plain text between');
}

// --- markdownToPortableText tests ---

{
  const blocks = markdownToPortableText('Hello world');
  assert(blocks.length === 1, 'simple paragraph: one block');
  assert(blocks[0].style === 'normal', 'simple paragraph: normal style');
  assert(!blocks[0].listItem, 'simple paragraph: no listItem');
}

{
  const blocks = markdownToPortableText('- item one\n- item two\n- item three');
  assert(blocks.length === 3, 'bullet list: three blocks');
  assert(blocks[0].listItem === 'bullet', 'bullet list: listItem is bullet');
  assert(blocks[0].level === 1, 'bullet list: level is 1');
  assert(blocks[0].children[0].text === 'item one', 'bullet list: correct text');
  assert(blocks[2].children[0].text === 'item three', 'bullet list: third item correct');
}

{
  const blocks = markdownToPortableText('1. first\n2. second\n3. third');
  assert(blocks.length === 3, 'numbered list: three blocks');
  assert(blocks[0].listItem === 'number', 'numbered list: listItem is number');
  assert(blocks[0].level === 1, 'numbered list: level is 1');
  assert(blocks[0].children[0].text === 'first', 'numbered list: correct text');
}

{
  const blocks = markdownToPortableText('Paragraph one.\n\n- bullet a\n- bullet b\n\nParagraph two.');
  assert(blocks.length === 4, 'mixed content: 1 para + 2 bullets + 1 para = 4 blocks');
  assert(!blocks[0].listItem, 'mixed: first is paragraph');
  assert(blocks[1].listItem === 'bullet', 'mixed: second is bullet');
  assert(blocks[2].listItem === 'bullet', 'mixed: third is bullet');
  assert(!blocks[3].listItem, 'mixed: fourth is paragraph');
}

{
  const blocks = markdownToPortableText('- **Bold item** with [link](https://example.com)');
  assert(blocks.length === 1, 'formatted bullet: one block');
  assert(blocks[0].listItem === 'bullet', 'formatted bullet: is bullet');
  assert(blocks[0].children.length >= 2, 'formatted bullet: multiple spans');
  assert(blocks[0].children[0].marks.includes('strong'), 'formatted bullet: has bold');
  assert(blocks[0].markDefs.length >= 1, 'formatted bullet: has link markDef');
}

{
  const blocks = markdownToPortableText('**Key takeaway.** The SEC [issued a fine](https://sec.gov/fine) of $150,000.');
  assert(blocks.length === 1, 'bold-lead takeaway: one block');
  const spans = blocks[0].children;
  assert(spans[0].marks.includes('strong'), 'bold-lead: first span is bold');
  assert(blocks[0].markDefs.length === 1, 'bold-lead: has link markDef');
}

{
  // Edge case: asterisks in math should not create italic (not a perfect guarantee, but test the simple case)
  const { children } = parseInlineFormatting('Use 3 * 4 = 12 for the calculation');
  // This may or may not match italic depending on regex — document the behavior
  console.log('NOTE: "3 * 4 = 12" parsing:', children.map((c) => `"${c.text}" [${c.marks}]`).join(', '));
}

{
  // Empty input
  const blocks = markdownToPortableText('');
  assert(blocks.length === 0, 'empty input: no blocks');
}

{
  const blocks = markdownToPortableText(null);
  assert(blocks.length === 0, 'null input: no blocks');
}

console.log('\nAll tests complete.');
