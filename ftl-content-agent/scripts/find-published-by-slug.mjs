#!/usr/bin/env node
// Find a published draft + topic by a slug fragment.
// Usage: node scripts/find-published-by-slug.mjs <slugFragment>

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ override: true });

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/find-published-by-slug.mjs <slugFragment>');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: drafts, error } = await supabase
  .from('content_drafts')
  .select('id, topic_id, blog_title, blog_slug, judge_pass, judge_scores, judge_flags, sanity_document_id, published_at, linkedin_post_id, x_post_id, created_at')
  .ilike('blog_slug', `%${slug}%`)
  .order('created_at', { ascending: false })
  .limit(5);

if (error) {
  console.error(error.message);
  process.exit(1);
}

if (!drafts?.length) {
  console.log(`No drafts found with slug like "%${slug}%"`);
  process.exit(0);
}

for (const d of drafts) {
  console.log('─'.repeat(70));
  console.log(`Draft ${d.id}`);
  console.log('─'.repeat(70));
  console.log(`title              : ${d.blog_title}`);
  console.log(`slug               : ${d.blog_slug}`);
  console.log(`judge_pass         : ${d.judge_pass}`);
  console.log(`sanity_document_id : ${d.sanity_document_id}`);
  console.log(`published_at       : ${d.published_at}`);
  console.log(`linkedin_post_id   : ${d.linkedin_post_id}`);
  console.log(`x_post_id          : ${d.x_post_id}`);
  console.log(`created_at         : ${d.created_at}`);
  if (d.judge_scores) {
    console.log('judge_scores:');
    for (const k of ['accuracy', 'engagement', 'seo', 'voice', 'structure']) {
      const v = d.judge_scores[k];
      const score = typeof v === 'number' ? v : v?.score;
      console.log(`  ${k.padEnd(10)} : ${score}`);
    }
  }

  const { data: topic } = await supabase
    .from('content_topics')
    .select('id, title, status, relevance_score, source_url, created_at, updated_at')
    .eq('id', d.topic_id)
    .maybeSingle();
  console.log();
  console.log('Topic:');
  console.log(`  id              : ${topic?.id}`);
  console.log(`  title           : ${topic?.title}`);
  console.log(`  status          : ${topic?.status}`);
  console.log(`  relevance_score : ${topic?.relevance_score}`);
  console.log(`  source_url      : ${topic?.source_url}`);
  console.log(`  topic created_at: ${topic?.created_at}`);
  console.log(`  topic updated_at: ${topic?.updated_at}`);
  console.log();
}
