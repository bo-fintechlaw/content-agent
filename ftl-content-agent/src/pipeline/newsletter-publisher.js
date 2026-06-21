import axios from 'axios';
import { createSanityClient } from '../integrations/sanity.js';
import { createResendClient, sendNewsletterBroadcast } from '../integrations/resend.js';
import {
  buildNewsletterEmailHtml,
  buildNewsletterEmailText,
} from '../emails/newsletter-issue-html.js';
import { parseIssueJson } from '../schemas/newsletter.js';
import { buildNewsletterSanityDocument } from './newsletter-renderer.js';
import { enrichIssueWithHeroImages } from './newsletter-hero-enrichment.js';
import { renderNewsletterCarousel } from '../integrations/newsletter-carousel.js';
import { generateNewsletterLinkedInPost } from './newsletter-social-generator.js';
import { sendNewsletterSocialReviewCard } from '../integrations/cmo-newsletter-slack.js';
import { createSlackClient } from '../integrations/slack.js';
import { fail, start, success } from '../utils/logger.js';

const PUBLIC_SITE = 'https://fintechlaw.ai';

/**
 * @param {Record<string, unknown>} config
 * @param {string} segment
 */
function audienceForSegment(config, segment) {
  if (segment === 'financial_services') return config.RESEND_AUDIENCE_FINANCIAL_SERVICES;
  if (segment === 'tech_ai_legal') return config.RESEND_AUDIENCE_TECH_AI_LEGAL;
  return config.RESEND_AUDIENCE_ID || null;
}

/**
 * Publish an approved newsletter issue.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} config
 * @param {{ issueId: string }} input
 */
export async function publishNewsletterIssue(supabase, config, input) {
  start('publishNewsletterIssue', { issueId: input.issueId });

  const { data: row, error } = await supabase
    .from('newsletter_issues')
    .select('*')
    .eq('id', input.issueId)
    .single();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('newsletter issue not found');
  if (row.status !== 'approved' && row.status !== 'review') {
    throw new Error(`cannot publish from status=${row.status}`);
  }

  let issue = parseIssueJson(row.issue_json);
  const archiveUrl = `${PUBLIC_SITE}/newsletters/${issue.slug}`;
  const nowIso = new Date().toISOString();

  let sanityClient = null;
  if (config.SANITY_PROJECT_ID && config.SANITY_API_TOKEN) {
    sanityClient = createSanityClient(config);
  }
  issue = await enrichIssueWithHeroImages(issue, sanityClient);

  let sanityPublishedId = row.sanity_document_id;
  if (sanityClient) {
    const draftId = row.sanity_document_id || `drafts.newsletter-${issue.slug}`;
    const doc = buildNewsletterSanityDocument(issue);
    await sanityClient.createOrReplace({ ...doc, _id: draftId });
    try {
      await sanityClient.action({
        actionType: 'sanity.action.document.publish',
        draftId,
        publishedId: draftId.replace(/^drafts\./, ''),
      });
      sanityPublishedId = draftId.replace(/^drafts\./, '');
    } catch (pubErr) {
      fail('publishNewsletterIssue:sanity', pubErr);
      throw pubErr;
    }

    if (config.NETLIFY_BUILD_HOOK) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        await axios.post(config.NETLIFY_BUILD_HOOK);
        success('publishNewsletterIssue:netlifyRebuild', { slug: issue.slug });
      } catch (netlifyErr) {
        fail('publishNewsletterIssue:netlifyRebuild', netlifyErr);
      }
    }
  }

  let carouselUrls = row.carousel_urls ?? [];
  if (!carouselUrls.length) {
    try {
      const carousel = await renderNewsletterCarousel(issue, { supabase });
      carouselUrls = carousel.urls;
    } catch (carouselErr) {
      fail('publishNewsletterIssue:carousel', carouselErr, { slug: issue.slug });
    }
  }

  let resendBroadcastId = null;
  const audienceId = audienceForSegment(config, issue.segment);
  if (config.RESEND_API_KEY && audienceId) {
    const resend = createResendClient(config.RESEND_API_KEY);
    const html = buildNewsletterEmailHtml(issue, {
      archiveUrl,
      unsubscribeUrl: `${PUBLIC_SITE}/unsubscribe`,
    });
    const text = buildNewsletterEmailText(issue, {
      archiveUrl,
      unsubscribeUrl: `${PUBLIC_SITE}/unsubscribe`,
    });
    const broadcast = await sendNewsletterBroadcast(resend, {
      audienceId,
      from: config.RESEND_FROM || 'FinTech Law <newsletter@fintechlaw.ai>',
      subject: `${issue.title} — ${issue.issue_date}`,
      html,
      text,
    });
    resendBroadcastId = broadcast?.id ?? null;
  }

  const linkedinPost = await generateNewsletterLinkedInPost(config, { issue, archiveUrl });

  const { error: updErr } = await supabase
    .from('newsletter_issues')
    .update({
      status: 'published',
      published_at: nowIso,
      sanity_document_id: sanityPublishedId,
      resend_broadcast_id: resendBroadcastId,
      web_preview_url: archiveUrl,
      issue_json: issue,
      carousel_urls: carouselUrls,
      linkedin_post: linkedinPost,
      social_approved: false,
      updated_at: nowIso,
    })
    .eq('id', input.issueId);
  if (updErr) throw new Error(updErr.message);

  if (resendBroadcastId) {
    await supabase.from('issue_metrics').upsert(
      {
        newsletter_issue_id: input.issueId,
        platform: 'resend',
        metric_kind: 'broadcast_sent',
        value: 1,
        idem_key: `resend-broadcast-${resendBroadcastId}`,
      },
      { onConflict: 'idem_key' }
    );
  }

  const channelId = config.SLACK_CMO_BO_CHANNEL_ID || config.SLACK_CHANNEL_ID;
  if (config.SLACK_BOT_TOKEN && channelId) {
    try {
      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendNewsletterSocialReviewCard(slack, channelId, {
        issueId: input.issueId,
        title: issue.title,
        archiveUrl,
        carouselUrls,
        linkedinPost,
      });
    } catch (slackErr) {
      fail('publishNewsletterIssue:socialCard', slackErr);
    }
  }

  const result = {
    issue_id: input.issueId,
    archive_url: archiveUrl,
    sanity_document_id: sanityPublishedId,
    resend_broadcast_id: resendBroadcastId,
    carousel_urls: carouselUrls,
    linkedin_post: linkedinPost,
  };
  success('publishNewsletterIssue', result);
  return result;
}
