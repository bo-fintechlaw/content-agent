#!/usr/bin/env node

/**
 * Offline pipeline simulation: exercises the Portable Text conversion
 * against realistic draft output, without requiring API credentials.
 *
 * Usage:  node scripts/simulate-pipeline-offline.mjs
 */

import { markdownToPortableText, blogSectionsToMainContent, parseInlineFormatting } from '../src/utils/portable-text.js';

// ── Helpers ────────────────────────────────────────────────────────────
function hr(label) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(70)}\n`);
}

let passCount = 0;
let failCount = 0;

function check(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passCount++;
  } else {
    console.log(`  FAIL  ${label}`);
    failCount++;
  }
}

// ── Realistic mock draft output (simulates what Claude would return) ──
const mockDraft = {
  blog_title: "CFPB Workforce Cuts: A Fintech Compliance Startup Guide",
  blog_slug: "cfpb-workforce-cuts-fintech-compliance-startup-guide",
  blog_body: [
    {
      title: "The CFPB Just Lost 200 Examiners — And Fintech Startups Should Pay Attention",
      body: "The **Consumer Financial Protection Bureau** announced last month that it will cut approximately 200 examination and enforcement staff as part of a broader [federal workforce reduction](https://www.whitehouse.gov/workforce-reduction-2026). For fintech startups navigating consumer lending, payments, and digital banking, this is not just a Beltway headline. It is a compliance inflection point.\n\nBut here is the part most coverage is missing. Fewer examiners does not mean less enforcement risk. It means *less predictable* enforcement risk. The [CFPB's 2026 supervisory priorities](https://www.consumerfinance.gov/policy-compliance/guidance/supervisory-highlights/) still target digital payments, earned wage access, and buy-now-pay-later products.",
      has_background: false,
    },
    {
      title: "What the Workforce Cuts Actually Mean for Enforcement Patterns",
      body: "The CFPB's enforcement docket tells the real story. In FY 2025, the Bureau filed 29 enforcement actions resulting in over **$590 million** in [consumer relief orders](https://www.consumerfinance.gov/enforcement/actions/). Even with a 15% staff reduction, the Bureau's per-examiner output has increased — fewer people are doing more targeted work.\n\nHere is the distinction that matters. The CFPB is not reducing its enforcement ambition. It is concentrating its resources on higher-impact targets. For fintech startups, that means:\n\n- Companies processing over **$10 million** in annual consumer transactions face heightened scrutiny\n- Earned wage access and BNPL products remain top examination priorities\n- State regulators are filling supervision gaps the CFPB leaves behind",
      has_background: false,
    },
    {
      title: "Three Compliance Steps Every Fintech Startup Should Take Now",
      body: "**First, audit your complaint response process.** With fewer CFPB staff handling [consumer complaints](https://www.consumerfinance.gov/complaint/), response timelines may extend — but the Bureau is also using complaint data algorithmically to identify enforcement targets. A spike in unresolved complaints is now a louder signal.\n\n**Second, map your state regulatory exposure.** As the CFPB pulls back, state attorneys general and state financial regulators are stepping in. The [Conference of State Bank Supervisors](https://www.csbs.org/) has already announced expanded multistate examinations for 2026.\n\n**Third, document your compliance management system.** The CFPB's [examination manual](https://www.consumerfinance.gov/compliance/supervision-examinations/) still defines the standard, even if examinations are less frequent. When examiners do arrive, they will expect:\n\n1. Written compliance policies covering all consumer-facing products\n2. Regular risk assessments with documented findings\n3. Training records showing staff completion within 90 days of onboarding\n4. Audit trails for consumer complaint resolution",
      has_background: true,
    },
    {
      title: "Key Takeaways",
      body: "**CFPB workforce cuts do not reduce enforcement risk.** The Bureau is concentrating resources on higher-impact targets, making enforcement less predictable but not less aggressive.\n\n**State regulators are filling the gap.** Fintech startups should expect increased state-level supervision, particularly through [multistate examinations coordinated by CSBS](https://www.csbs.org/).\n\n**Complaint data is now an enforcement trigger.** The CFPB is using algorithmic analysis of consumer complaints to prioritize enforcement actions — making complaint management a critical compliance function.\n\n**Documentation is your best defense.** A well-documented compliance management system is the single most effective protection against both federal and state enforcement actions.",
      has_background: true,
    },
    {
      title: "Building Compliance Infrastructure That Scales",
      body: "The real question is not whether the CFPB will examine your company. It is whether your compliance infrastructure will hold up when any regulator — federal or state — comes knocking.\n\nFinTech Law helps fintech startups build compliance frameworks designed for this exact environment: scalable, documented, and regulator-ready. If your company is processing consumer transactions and you have not reviewed your compliance management system in the last six months, [we would welcome the conversation](https://fintechlaw.ai/contact).\n\nThis blog post is for informational purposes only and does not constitute legal advice. No attorney-client relationship is formed by reading this content. If you need legal advice, please contact a qualified attorney.",
      has_background: false,
    },
  ],
  blog_seo_title: "CFPB Workforce Cuts: Fintech Compliance Startup Guide",
  blog_seo_description: "CFPB staff cuts change fintech enforcement risk. Three compliance steps every fintech startup should take now to prepare for shifting federal and state supervision.",
  blog_seo_keywords: "CFPB regulation, fintech compliance, fintech startup, consumer protection, BNPL regulation",
  blog_category: "regulatory",
  blog_tags: "CFPB, fintech compliance, enforcement, startup, consumer protection",
};

// ┌──────────────────────────────────────────────────────────────────────┐
// │  STAGE 1: Validate raw draft formatting                             │
// └──────────────────────────────────────────────────────────────────────┘
hr('STAGE 1: Raw Draft Formatting Validation');

let totalLinks = 0;
let hasBold = false;
let hasBullet = false;
let hasNumber = false;
let hasBackground = false;
const bgSections = [];

for (const section of mockDraft.blog_body) {
  const body = section.body;
  if (/\*\*.+?\*\*/.test(body)) hasBold = true;
  const linkMatches = body.match(/\[.+?\]\(.+?\)/g);
  if (linkMatches) totalLinks += linkMatches.length;
  if (/^[-*]\s+/m.test(body)) hasBullet = true;
  if (/^\d+\.\s+/m.test(body)) hasNumber = true;
  if (section.has_background) {
    hasBackground = true;
    bgSections.push(section.title);
  }
}

check(hasBold, 'Draft contains bold formatting (**...**)');
check(totalLinks >= 3, `Draft contains >= 3 inline source links (found ${totalLinks})`);
check(hasBullet, 'Draft contains bullet lists (- ...)');
check(hasNumber, 'Draft contains numbered lists (1. ...)');
check(hasBackground, `Draft has has_background sections: ${bgSections.join(', ')}`);

// ┌──────────────────────────────────────────────────────────────────────┐
// │  STAGE 2: Portable Text Conversion                                  │
// └──────────────────────────────────────────────────────────────────────┘
hr('STAGE 2: Portable Text Conversion');

const mainContent = blogSectionsToMainContent(mockDraft.blog_body);

let totalBlocks = 0;
let strongSpans = 0;
let emSpans = 0;
let linkMarkDefs = 0;
let bulletBlocks = 0;
let numberBlocks = 0;
let backgroundSections = 0;

for (const section of mainContent) {
  if (section.hasBackgroundColor) backgroundSections++;
  for (const block of section.body) {
    totalBlocks++;
    if (block.listItem === 'bullet') bulletBlocks++;
    if (block.listItem === 'number') numberBlocks++;
    linkMarkDefs += (block.markDefs ?? []).filter((d) => d._type === 'link').length;
    for (const child of block.children ?? []) {
      if (child.marks?.includes('strong')) strongSpans++;
      if (child.marks?.includes('em')) emSpans++;
    }
  }
}

console.log('Conversion statistics:');
console.log(`  Total sections:       ${mainContent.length}`);
console.log(`  Total blocks:         ${totalBlocks}`);
console.log(`  Bold (strong) spans:  ${strongSpans}`);
console.log(`  Italic (em) spans:    ${emSpans}`);
console.log(`  Link markDefs:        ${linkMarkDefs}`);
console.log(`  Bullet list blocks:   ${bulletBlocks}`);
console.log(`  Numbered list blocks: ${numberBlocks}`);
console.log(`  Background sections:  ${backgroundSections}`);
console.log('');

check(strongSpans > 0, 'Portable Text contains bold (strong) spans');
check(linkMarkDefs > 0, `Portable Text contains link markDefs (${linkMarkDefs} links)`);
check(bulletBlocks > 0, `Portable Text contains bullet list blocks (${bulletBlocks} items)`);
check(numberBlocks > 0, `Portable Text contains numbered list blocks (${numberBlocks} items)`);
check(backgroundSections > 0, `Portable Text has ${backgroundSections} background-colored section(s)`);

// ┌──────────────────────────────────────────────────────────────────────┐
// │  STAGE 3: Detailed Block Inspection                                 │
// └──────────────────────────────────────────────────────────────────────┘
hr('STAGE 3: Detailed Block Inspection');

for (const section of mainContent) {
  console.log(`\n--- Section: "${section.title}" (bg: ${section.hasBackgroundColor}) ---`);
  for (let i = 0; i < section.body.length; i++) {
    const block = section.body[i];
    const listTag = block.listItem ? ` [${block.listItem} list, level ${block.level}]` : '';
    console.log(`  Block ${i + 1}${listTag}:`);

    if (block.markDefs?.length) {
      for (const def of block.markDefs) {
        console.log(`    markDef: ${def._type} → ${def.href ?? ''}`);
      }
    }

    for (const child of block.children) {
      const marksStr = child.marks?.length ? ` [${child.marks.filter((m) => m === 'strong' || m === 'em').join(',')}${child.marks.some((m) => m !== 'strong' && m !== 'em') ? ',link' : ''}]` : '';
      const text = child.text.length > 100 ? child.text.slice(0, 100) + '...' : child.text;
      console.log(`    span: "${text}"${marksStr}`);
    }
  }
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  STAGE 4: Edge Case Tests                                           │
// └──────────────────────────────────────────────────────────────────────┘
hr('STAGE 4: Edge Case Tests');

// Bold-lead takeaway pattern
{
  const blocks = markdownToPortableText('**Advisory agreement language carries real regulatory risk.** The FamilyWealth enforcement action resulted in $150,000 in penalties.');
  check(blocks.length === 1, 'Bold-lead takeaway: single block');
  check(blocks[0].children[0].marks.includes('strong'), 'Bold-lead takeaway: first span is bold');
  check(blocks[0].children[1].marks.length === 0, 'Bold-lead takeaway: second span is plain');
}

// Mixed list with inline formatting
{
  const blocks = markdownToPortableText('- **First item** with [link](https://example.com)\n- Second item\n- *Third item*');
  check(blocks.length === 3, 'Formatted list: three blocks');
  check(blocks[0].listItem === 'bullet', 'Formatted list: bullet type');
  check(blocks[0].children[0].marks.includes('strong'), 'Formatted list: first item has bold');
  check(blocks[0].markDefs.length === 1, 'Formatted list: first item has link markDef');
  check(blocks[2].children[0].marks.includes('em'), 'Formatted list: third item has italic');
}

// Paragraph followed by list followed by paragraph
{
  const input = 'Opening paragraph here.\n\n- Bullet one\n- Bullet two\n\nClosing paragraph.';
  const blocks = markdownToPortableText(input);
  check(blocks.length === 4, 'Para-list-para: four blocks (1 + 2 + 1)');
  check(!blocks[0].listItem, 'Para-list-para: first is paragraph');
  check(blocks[1].listItem === 'bullet', 'Para-list-para: second is bullet');
  check(blocks[2].listItem === 'bullet', 'Para-list-para: third is bullet');
  check(!blocks[3].listItem, 'Para-list-para: fourth is paragraph');
}

// Nested bold inside link
{
  const { children, markDefs } = parseInlineFormatting('[**Bold link text**](https://example.com)');
  check(markDefs.length === 1, 'Bold-in-link: has link markDef');
  check(children[0].marks.includes('strong'), 'Bold-in-link: span has strong');
  check(children[0].marks.includes(markDefs[0]._key), 'Bold-in-link: span has link mark');
}

// Link inside bold
{
  const { children, markDefs } = parseInlineFormatting('**See [this report](https://sec.gov) for details**');
  const linkDef = markDefs.find((d) => d._type === 'link');
  check(!!linkDef, 'Link-in-bold: has link markDef');
  const linkSpan = children.find((c) => c.text === 'this report');
  check(linkSpan?.marks.includes('strong'), 'Link-in-bold: link text is bold');
  check(linkSpan?.marks.includes(linkDef._key), 'Link-in-bold: link text has link mark');
}

// Empty and null inputs
{
  check(markdownToPortableText('').length === 0, 'Empty string: no blocks');
  check(markdownToPortableText(null).length === 0, 'Null input: no blocks');
  check(markdownToPortableText(undefined).length === 0, 'Undefined input: no blocks');
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  SUMMARY                                                            │
// └──────────────────────────────────────────────────────────────────────┘
hr('SIMULATION SUMMARY');

console.log(`Results: ${passCount} passed, ${failCount} failed out of ${passCount + failCount} checks\n`);

if (failCount === 0) {
  console.log('ALL CHECKS PASSED — formatting pipeline is working correctly.');
  console.log('');
  console.log('The portable text converter now properly handles:');
  console.log('  - Bold text (**...**) → marks: [strong]');
  console.log('  - Italic text (*...*) → marks: [em]');
  console.log('  - Links ([text](url)) → markDefs + mark references');
  console.log('  - Bullet lists (- item) → listItem: bullet');
  console.log('  - Numbered lists (1. item) → listItem: number');
  console.log('  - Nested formatting (bold inside links, links inside bold)');
  console.log('  - has_background → hasBackgroundColor for callout sections');
} else {
  console.log(`${failCount} CHECK(S) FAILED — review output above for details.`);
  process.exitCode = 1;
}
