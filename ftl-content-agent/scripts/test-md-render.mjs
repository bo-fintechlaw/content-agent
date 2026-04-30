#!/usr/bin/env node
// Replicate the markdown→HTML pipeline from api.js to debug preview rendering.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const draftId = process.argv[2];
const sectionIdx = Number(process.argv[3] ?? 2);
if (!draftId) {
  console.error('Usage: node scripts/test-md-render.mjs <draftId> [sectionIdx=2]');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data } = await supabase
  .from('content_drafts')
  .select('blog_body')
  .eq('id', draftId)
  .maybeSingle();
const body = String(data?.blog_body?.[sectionIdx]?.body ?? '');

function escHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function inlineMarkdown(t) {
  let h = escHtml(t);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h;
}
function markdownToHtml(md) {
  const lines = String(md ?? '').replaceAll('\r\n', '\n').split('\n');
  const out = [];
  let inUl = false, inOl = false, paragraph = [];
  const flush = () => { if (paragraph.length) { out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`); paragraph = []; } };
  const close = () => { if (inUl) out.push('</ul>'); if (inOl) out.push('</ol>'); inUl = inOl = false; };
  for (const r of lines) {
    const line = r.trim();
    if (!line) { flush(); close(); continue; }
    if (line.startsWith('### ')) { flush(); close(); out.push(`<h4>${inlineMarkdown(line.slice(4))}</h4>`); continue; }
    if (line.startsWith('## ')) { flush(); close(); out.push(`<h3>${inlineMarkdown(line.slice(3))}</h3>`); continue; }
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) { flush(); if (!inUl) { close(); inUl = true; out.push('<ul>'); } out.push(`<li>${inlineMarkdown(ul[1])}</li>`); continue; }
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) { flush(); if (!inOl) { close(); inOl = true; out.push('<ol>'); } out.push(`<li>${inlineMarkdown(ol[1])}</li>`); continue; }
    paragraph.push(line);
  }
  flush(); close();
  return out.join('\n');
}

console.log('--- raw body ---');
console.log(body);
console.log();
console.log('--- char codes of first 60 chars ---');
const head = body.slice(0, 60);
console.log([...head].map((c, i) => `${i}:${c}=${c.charCodeAt(0)}`).join(' '));
console.log();
console.log('--- markdownToHtml output ---');
console.log(markdownToHtml(body));
