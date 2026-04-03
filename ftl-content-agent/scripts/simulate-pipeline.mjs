#!/usr/bin/env node

/**
 * End-to-end simulation: Draft → Judge → Portable Text conversion.
 *
 * Exercises the full content pipeline locally using the Anthropic API,
 * then validates the output against the formatting requirements added
 * in the marketing-feedback improvements.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/simulate-pipeline.mjs
 *
 * Optional env vars:
 *   ANTHROPIC_MODEL  (default: claude-sonnet-4-6)
 */

import Anthropic from '@anthropic-ai/sdk';
import { DRAFTER_SYSTEM_PROMPT, buildDrafterUserPrompt } from '../src/prompts/drafter-system.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt } from '../src/prompts/judge-system.js';
import { DEFAULT_SEO_KEYWORDS } from '../src/config/seo-keywords.js';
import { markdownToPortableText, blogSectionsToMainContent, parseInlineFormatting } from '../src/utils/portable-text.js';

// ── Config ─────────────────────────────────────────────────────────────
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ERROR: Set ANTHROPIC_API_KEY env var to run this simulation.');
  process.exit(1);
}
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

// ── Helpers ────────────────────────────────────────────────────────────
function hr(label) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(70)}\n`);
}

function parseJsonResponse(text) {
  let cleaned = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  try { return JSON.parse(cleaned); } catch { /* */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Response missing JSON object');
  let json = match[0].replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(json);
}

// ── Sample topic (mirrors real scanner output) ─────────────────────────
const sampleTopic = {
  id: 'sim-001',
  title: 'CFPB Workforce Cuts Raise Questions for Fintech Compliance',
  summary: 'The Consumer Financial Protection Bureau has cut hundreds of staff positions amid reorganization. Fintech startups relying on CFPB guidance and enforcement patterns now face uncertainty about supervision priorities, complaint handling timelines, and rulemaking schedules. Industry groups warn that reduced staffing could mean slower responses but also less predictable enforcement.',
  category: 'regulatory',
  relevance_score: 9.2,
  source_url: 'https://www.reuters.com/business/finance/cfpb-workforce-cuts-2026',
  status: 'ranked',
};

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const client = new Anthropic({ apiKey: API_KEY });

  // ┌──────────────────────────────────────────────────────────────────┐
  // │  STAGE 1: DRAFTER                                                │
  // └──────────────────────────────────────────────────────────────────┘
  hr('STAGE 1: DRAFTING');
  console.log('Topic:', sampleTopic.title);
  console.log('Model:', MODEL);
  console.log('Sending to Anthropic...\n');

  const drafterStart = Date.now();
  const drafterResp = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0.3,
    system: DRAFTER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildDrafterUserPrompt({ topic: sampleTopic, seoKeywords: DEFAULT_SEO_KEYWORDS }) }],
  });
  const drafterMs = Date.now() - drafterStart;
  const drafterText = drafterResp.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const draft = parseJsonResponse(drafterText);

  console.log(`Drafter completed in ${(drafterMs / 1000).toFixed(1)}s`);
  console.log(`Tokens: input=${drafterResp.usage.input_tokens}, output=${drafterResp.usage.output_tokens}`);
  console.log(`\nTitle: ${draft.blog_title}`);
  console.log(`Slug: ${draft.blog_slug}`);
  console.log(`Sections: ${draft.blog_body?.length ?? 0}`);
  console.log(`Category: ${draft.blog_category}`);

  // ── Formatting checks on raw draft ──
  hr('STAGE 1 CHECKS: Raw Draft Formatting');
  const checks = {
    has_bold: false,
    has_links: false,
    has_bullet_list: false,
    has_numbered_list: false,
    has_background_section: false,
    link_count: 0,
    sections_with_has_background: [],
  };

  for (const section of draft.blog_body ?? []) {
    const body = String(section.body ?? '');
    if (/\*\*.+?\*\*/.test(body)) checks.has_bold = true;
    if (/\[.+?\]\(.+?\)/.test(body)) checks.has_links = true;
    const linkMatches = body.match(/\[.+?\]\(.+?\)/g);
    if (linkMatches) checks.link_count += linkMatches.length;
    if (/^[-*]\s+/m.test(body)) checks.has_bullet_list = true;
    if (/^\d+\.\s+/m.test(body)) checks.has_numbered_list = true;
    if (section.has_background) {
      checks.has_background_section = true;
      checks.sections_with_has_background.push(section.title);
    }
  }

  console.log('Draft formatting analysis:');
  console.log(`  Bold text (**...**):        ${checks.has_bold ? 'YES' : 'MISSING'}`);
  console.log(`  Inline links ([]()):        ${checks.has_links ? `YES (${checks.link_count} links)` : 'MISSING'}`);
  console.log(`  Bullet lists (- ...):       ${checks.has_bullet_list ? 'YES' : 'MISSING'}`);
  console.log(`  Numbered lists (1. ...):    ${checks.has_numbered_list ? 'YES' : 'MISSING'}`);
  console.log(`  has_background sections:    ${checks.has_background_section ? checks.sections_with_has_background.join(', ') : 'NONE'}`);

  // Print each section body for inspection
  hr('STAGE 1 OUTPUT: Section Bodies');
  for (const section of draft.blog_body ?? []) {
    console.log(`--- ${section.title} (has_background: ${!!section.has_background}) ---`);
    console.log(section.body);
    console.log('');
  }

  // ┌──────────────────────────────────────────────────────────────────┐
  // │  STAGE 2: JUDGE                                                  │
  // └──────────────────────────────────────────────────────────────────┘
  hr('STAGE 2: JUDGING');
  console.log('Sending draft to judge...\n');

  const judgeStart = Date.now();
  const judgeResp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    temperature: 0.1,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildJudgeUserPrompt({ draft }) }],
  });
  const judgeMs = Date.now() - judgeStart;
  const judgeText = judgeResp.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const judgeResult = parseJsonResponse(judgeText);

  console.log(`Judge completed in ${(judgeMs / 1000).toFixed(1)}s`);
  console.log(`Tokens: input=${judgeResp.usage.input_tokens}, output=${judgeResp.usage.output_tokens}\n`);

  console.log('Scores:');
  for (const [key, val] of Object.entries(judgeResult.scores ?? {})) {
    const score = typeof val === 'number' ? val : val?.score ?? '?';
    const rationale = typeof val === 'object' ? val?.rationale ?? '' : '';
    console.log(`  ${key.padEnd(12)} ${String(score).padEnd(4)} ${rationale}`);
  }
  console.log(`\n  Composite:  ${judgeResult.composite}`);
  console.log(`  Verdict:    ${judgeResult.verdict}`);

  if (judgeResult.strengths?.length) {
    console.log('\nStrengths:');
    for (const s of judgeResult.strengths) console.log(`  + ${s}`);
  }
  if (judgeResult.flags?.length) {
    console.log('\nFlags:');
    for (const f of judgeResult.flags) console.log(`  ! ${f}`);
  }
  if (judgeResult.revision_instructions?.length) {
    console.log('\nRevision instructions:');
    for (const r of judgeResult.revision_instructions) console.log(`  > ${r}`);
  }

  // ── Verify formatting score exists ──
  const fmtScore = judgeResult.scores?.formatting;
  if (fmtScore !== undefined) {
    const score = typeof fmtScore === 'number' ? fmtScore : fmtScore?.score;
    console.log(`\nFormatting score present: YES (${score}/10)`);
  } else {
    console.log('\nWARNING: Judge did not return a formatting score!');
  }

  // ┌──────────────────────────────────────────────────────────────────┐
  // │  STAGE 3: PORTABLE TEXT CONVERSION                               │
  // └──────────────────────────────────────────────────────────────────┘
  hr('STAGE 3: PORTABLE TEXT CONVERSION');

  const mainContent = blogSectionsToMainContent(draft.blog_body);

  let totalBlocks = 0;
  let boldSpans = 0;
  let linkDefs = 0;
  let bulletBlocks = 0;
  let numberBlocks = 0;
  let bgSections = 0;

  for (const section of mainContent) {
    if (section.hasBackgroundColor) bgSections++;
    for (const block of section.body ?? []) {
      totalBlocks++;
      if (block.listItem === 'bullet') bulletBlocks++;
      if (block.listItem === 'number') numberBlocks++;
      linkDefs += (block.markDefs ?? []).length;
      for (const child of block.children ?? []) {
        if (child.marks?.includes('strong')) boldSpans++;
      }
    }
  }

  console.log('Portable Text conversion results:');
  console.log(`  Sections:              ${mainContent.length}`);
  console.log(`  Total blocks:          ${totalBlocks}`);
  console.log(`  Bold spans (strong):   ${boldSpans}`);
  console.log(`  Link markDefs:         ${linkDefs}`);
  console.log(`  Bullet list blocks:    ${bulletBlocks}`);
  console.log(`  Number list blocks:    ${numberBlocks}`);
  console.log(`  Background sections:   ${bgSections}`);

  // Print one section in detail for inspection
  hr('STAGE 3 SAMPLE: First section Portable Text');
  if (mainContent[0]) {
    console.log(`Section title: "${mainContent[0].title}"`);
    console.log(`hasBackgroundColor: ${mainContent[0].hasBackgroundColor}`);
    console.log(`Blocks: ${mainContent[0].body.length}`);
    for (const block of mainContent[0].body.slice(0, 3)) {
      console.log(`\n  Block [style=${block.style}${block.listItem ? `, listItem=${block.listItem}` : ''}]:`);
      console.log(`    markDefs: ${JSON.stringify(block.markDefs.map((d) => ({ type: d._type, href: d.href })))}`);
      for (const child of block.children) {
        console.log(`    span: "${child.text.slice(0, 80)}${child.text.length > 80 ? '...' : ''}" marks=[${child.marks.join(',')}]`);
      }
    }
  }

  // ┌──────────────────────────────────────────────────────────────────┐
  // │  SUMMARY                                                         │
  // └──────────────────────────────────────────────────────────────────┘
  hr('SIMULATION SUMMARY');

  const issues = [];
  if (!checks.has_bold) issues.push('Drafter did not produce bold formatting');
  if (!checks.has_links) issues.push('Drafter did not produce inline source links');
  if (checks.link_count < 3) issues.push(`Only ${checks.link_count} source links (minimum 3 required)`);
  if (!checks.has_bullet_list && !checks.has_numbered_list) issues.push('Drafter did not produce any lists');
  if (!checks.has_background_section) issues.push('No section has has_background: true');
  if (boldSpans === 0) issues.push('Portable Text has no bold spans (strong marks)');
  if (linkDefs === 0) issues.push('Portable Text has no link markDefs');
  if (bulletBlocks === 0 && numberBlocks === 0) issues.push('Portable Text has no list blocks');
  if (!fmtScore) issues.push('Judge did not return formatting score');

  const verdict = judgeResult.verdict;

  if (issues.length === 0) {
    console.log('ALL CHECKS PASSED');
    console.log(`  Draft has bold, links (${checks.link_count}), lists, and callout sections`);
    console.log(`  Portable Text correctly preserves bold spans, link markDefs, and list blocks`);
    console.log(`  Judge returned formatting score: ${typeof fmtScore === 'object' ? fmtScore.score : fmtScore}/10`);
    console.log(`  Judge verdict: ${verdict} (composite: ${judgeResult.composite})`);
  } else {
    console.log(`${issues.length} ISSUE(S) FOUND:`);
    for (const issue of issues) console.log(`  - ${issue}`);
    console.log(`\n  Judge verdict: ${verdict} (composite: ${judgeResult.composite})`);
  }

  console.log(`\nTotal time: ${((drafterMs + judgeMs) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
