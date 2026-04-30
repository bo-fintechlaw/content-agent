#!/usr/bin/env node
/**
 * Patch a published post’s `mainContent` from an enriched `blog_body` in Supabase.
 *
 *   node scripts/patch-post-rich-format.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { createSanityClient, patchPublishedBlogMainContent } from '../src/integrations/sanity.js';

const DRAFT_ID = 'f0ae6bae-091d-4b20-8e8e-fb86d33a7965';
const PUBLISHED_SANITY_ID = 'a63ab8d5c174f74255d3';

function keyTakeawayBullets(body) {
  return body
    .split(/\n\n+/)
    .map((p) => {
      const t = p.trim();
      if (!t) return '';
      if (t.startsWith('**') && !t.startsWith('- ')) return '- ' + t;
      return t;
    })
    .filter(Boolean)
    .join('\n\n');
}

function enrichBlogBody(sections) {
  const s = JSON.parse(JSON.stringify(sections));
  for (let i = 0; i < s.length; i++) {
    const t = s[i].title;
    let b = s[i].body;

    if (t === 'The Compliance Gap That Kills Fintech Startups Before They Scale') {
      b = b.replace(
        'It is a foundation you build before your first customer signs up.\n\nThis post covers',
        'It is a foundation you build before your first customer signs up.\n\n## The five foundations in this post\n\nThis post covers'
      );
    } else if (
      t ===
      'Terms of Service and Privacy Policy: Your First Regulatory Document, Not a Legal Formality'
    ) {
      b = b.replace(
        'enforcement action.\n\nThe practical rule is straightforward',
        'enforcement action.\n\n## The practical rule: audit the product, not a static PDF\n\nThe practical rule is straightforward'
      );
      b = b.replace(
        'forgotten at incorporation.\n\nFor fintech startups specifically',
        'forgotten at incorporation.\n\n## Why fintech product language carries extra weight\n\nFor fintech startups specifically'
      );
    } else if (
      t === 'Money Transmitter Licensing: The Regulatory Trap Hidden in Your Payment Flow'
    ) {
      b = b.replace(
        'federal level for certain transaction types.\n\nAs of 2025',
        'federal level for certain transaction types.\n\n## Multistate licensing, NMLS, and timing\n\nAs of 2025'
      );
      b = b.replace(
        'after the first user transaction clears.\n\nThe digital assets dimension',
        'after the first user transaction clears.\n\n## Digital-asset and BitLicense layers\n\nThe digital assets dimension'
      );
    } else if (
      t ===
      'Digital Assets and SEC Enforcement: The Legal Theory Has Not Changed, Only the Targets'
    ) {
      b = b.replace(
        "or 'points systems.'\n\nIn SEC v. Ripple Labs",
        "or 'points systems.'\n\n## Howey, Ripple, and retail sales\n\nIn SEC v. Ripple Labs"
      );
    } else if (
      t ===
      'CFPB Section 1033 and Open Banking: The Third-Party Trap Your Data Agreements Are Missing'
    ) {
      b = b.replace(
        "do not address.\n\nThe provision most founders miss",
        "do not address.\n\n## The third-party authorization gap\n\nThe provision most founders miss"
      );
      b = b.replace(
        'in production, not after your first examination.\n\nThe compliance timeline',
        'in production, not after your first examination.\n\n## Phase-in and fintech on the data edge\n\nThe compliance timeline'
      );
    } else if (
      t === 'Scalable Legal Infrastructure: Build the Foundation Before You Need It'
    ) {
      b = b.replace(
        'a bank sponsor.\n\nScalable legal infrastructure means three things in practice',
        'a bank sponsor.\n\n## Scalable legal infrastructure, in three parts\n\nScalable legal infrastructure means three things in practice'
      );
    } else if (t === 'Key Takeaways') {
      b = keyTakeawayBullets(b);
    } else if (t === 'The Five Foundations Are Not Optional — They Are the Baseline') {
      b = b.replace(
        "plaintiff's attorney.\n\nFinTech Law works with fintech",
        "plaintiff's attorney.\n\n## CTA: build infrastructure that matches your roadmap\n\nFinTech Law works with fintech"
      );
    }
    s[i].body = b;
  }
  return s;
}

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const { data: row, error } = await supa
  .from('content_drafts')
  .select('id, blog_body, sanity_document_id')
  .eq('id', DRAFT_ID)
  .single();
if (error) throw error;
if (!row?.blog_body) throw new Error('No blog_body on draft');

const blogBody = enrichBlogBody(row.blog_body);

const { error: uErr } = await supa
  .from('content_drafts')
  .update({ blog_body: blogBody })
  .eq('id', DRAFT_ID);
if (uErr) throw uErr;
console.log('Updated content_drafts.blog_body');

const sanity = createSanityClient({
  SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
  SANITY_DATASET: process.env.SANITY_DATASET,
  SANITY_API_TOKEN: process.env.SANITY_API_TOKEN,
  SANITY_SCHEMA_ID: process.env.SANITY_SCHEMA_ID || 'placeholder',
});
const docId = (row.sanity_document_id || PUBLISHED_SANITY_ID).trim();
await patchPublishedBlogMainContent(sanity, docId, blogBody);
console.log('Patched Sanity mainContent for', docId);

if (process.env.NETLIFY_BUILD_HOOK) {
  try {
    await axios.post(process.env.NETLIFY_BUILD_HOOK);
    console.log('Triggered Netlify build');
  } catch (e) {
    console.warn('Netlify hook failed (non-fatal):', e.message);
  }
}
