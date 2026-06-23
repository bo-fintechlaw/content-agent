#!/usr/bin/env node
/**
 * Re-render LinkedIn carousel panels for a published newsletter issue and
 * optionally re-post the Gate 2 Slack social review card.
 *
 *   ISSUE_ID=uuid node scripts/rerender-newsletter-carousel.mjs
 *   ISSUE_ID=uuid SLACK=0 node scripts/rerender-newsletter-carousel.mjs  # skip Slack
 *
 * env: SUPABASE_FLEET_URL + SUPABASE_FLEET_SERVICE_KEY (or legacy SUPABASE_*),
 *      SLACK_BOT_TOKEN + SLACK_CMO_BO_CHANNEL_ID for Slack card
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { renderNewsletterCarousel } from '../src/integrations/newsletter-carousel.js';
import { sendNewsletterSocialReviewCard } from '../src/integrations/cmo-newsletter-slack.js';
import { createSlackClient } from '../src/integrations/slack.js';
import { parseIssueJson } from '../src/schemas/newsletter.js';

const issueId = process.env.ISSUE_ID?.trim();
if (!issueId) {
  console.error('ISSUE_ID is required');
  process.exit(1);
}

const fleetUrl = process.env.SUPABASE_FLEET_URL || process.env.SUPABASE_URL;
const fleetKey = process.env.SUPABASE_FLEET_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!fleetUrl || !fleetKey) {
  console.error('SUPABASE_FLEET_URL and SUPABASE_FLEET_SERVICE_KEY required (or legacy SUPABASE_*)');
  process.exit(1);
}

const postSlack = process.env.SLACK !== '0';

const supabase = createClient(fleetUrl, fleetKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: row, error } = await supabase
  .from('newsletter_issues')
  .select('id, issue_json, linkedin_post, web_preview_url, title')
  .eq('id', issueId)
  .single();
if (error) throw new Error(error.message);
if (!row) throw new Error(`newsletter issue not found: ${issueId}`);

const issue = parseIssueJson(row.issue_json);
console.log(`Rendering carousel for "${issue.title}" (${issue.slug})…`);

const { urls } = await renderNewsletterCarousel(issue, { supabase });
console.log(`Uploaded ${urls.length} panel(s):`);
for (const url of urls) console.log(`  ${url}`);

const nowIso = new Date().toISOString();
const { error: updErr } = await supabase
  .from('newsletter_issues')
  .update({ carousel_urls: urls, updated_at: nowIso })
  .eq('id', issueId);
if (updErr) throw new Error(updErr.message);

console.log(`Updated newsletter_issues.carousel_urls for ${issueId}`);

if (postSlack) {
  const channelId = process.env.SLACK_CMO_BO_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !channelId) {
    console.warn('SLACK_BOT_TOKEN or channel id missing — skipping Gate 2 card');
  } else {
    const archiveUrl =
      row.web_preview_url ?? `https://fintechlaw.ai/newsletters/${issue.slug}`;
    const slack = createSlackClient(token);
    await sendNewsletterSocialReviewCard(slack, channelId, {
      issueId,
      title: issue.title,
      archiveUrl,
      carouselUrls: urls,
      linkedinPost: row.linkedin_post ?? '',
    });
    console.log('Posted Gate 2 Slack social review card');
  }
}

console.log('Done.');
