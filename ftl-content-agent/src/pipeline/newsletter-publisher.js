import { createSanityClient } from '../integrations/sanity.js';
import { createResendClient, sendNewsletterBroadcast } from '../integrations/resend.js';
import {
  buildNewsletterEmailHtml,
  buildNewsletterEmailText,
} from '../emails/newsletter-issue-html.js';
import { parseIssueJson } from '../schemas/newsletter.js';
import { buildNewsletterSanityDocument } from './newsletter-renderer.js';
import { renderNewsletterCarousel } from '../integrations/newsletter-carousel.js';
import { postLinkedInUgc } from '../integrations/linkedin.js';
import { postXTweet } from '../integrations/x.js';
import { fail, start, success } from '../utils/logger.js';

const PUBLIC_SITE = 'https://fintechlaw.ai';

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

  const issue = parseIssueJson(row.issue_json);
  const archiveUrl = `${PUBLIC_SITE}/newsletter/${issue.slug}`;
  const nowIso = new Date().toISOString();

  let sanityPublishedId = row.sanity_document_id;
  if (config.SANITY_PROJECT_ID && config.SANITY_API_TOKEN) {
    const client = createSanityClient(config);
    const draftId = row.sanity_document_id || `drafts.newsletter-${issue.slug}`;
    if (!row.sanity_document_id) {
      const doc = buildNewsletterSanityDocument(issue);
      await client.createOrReplace({ ...doc, _id: draftId });
    }
    try {
      await client.action({
        actionType: 'sanity.action.document.publish',
        draftId,
        publishedId: draftId.replace(/^drafts\./, ''),
      });
      sanityPublishedId = draftId.replace(/^drafts\./, '');
    } catch (pubErr) {
      fail('publishNewsletterIssue:sanity', pubErr);
      throw pubErr;
    }
  }

  let carouselUrls = row.carousel_urls ?? [];
  if (!carouselUrls.length) {
    try {
      const carousel = await renderNewsletterCarousel(issue);
      carouselUrls = carousel.urls;
    } catch (carouselErr) {
      fail('publishNewsletterIssue:carousel', carouselErr, { slug: issue.slug });
    }
  }

  let resendBroadcastId = null;
  if (config.RESEND_API_KEY && config.RESEND_AUDIENCE_ID) {
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
      audienceId: config.RESEND_AUDIENCE_ID,
      from: config.RESEND_FROM_EMAIL || 'FinTech Law <newsletter@fintechlaw.ai>',
      subject: `${issue.title} — ${issue.issue_date}`,
      html,
      text,
    });
    resendBroadcastId = broadcast?.id ?? null;
  }

  const socialText = buildNewsletterSocialPost(issue, archiveUrl);
  let linkedinPostId = null;
  let xPostId = null;

  if (config.LINKEDIN_ACCESS_TOKEN && config.LINKEDIN_PERSON_URN) {
    try {
      const { id } = await postLinkedInUgc({
        accessToken: config.LINKEDIN_ACCESS_TOKEN,
        personUrn: config.LINKEDIN_PERSON_URN,
        text: socialText,
      });
      linkedinPostId = id;
    } catch (liErr) {
      fail('publishNewsletterIssue:linkedin', liErr);
    }
  }

  if (config.ENABLE_X_POSTING && config.X_API_KEY) {
    try {
      const { id } = await postXTweet({
        consumerKey: config.X_API_KEY,
        consumerSecret: config.X_API_SECRET,
        accessToken: config.X_ACCESS_TOKEN,
        accessTokenSecret: config.X_ACCESS_TOKEN_SECRET,
        text: socialText.slice(0, 280),
      });
      xPostId = id;
    } catch (xErr) {
      fail('publishNewsletterIssue:x', xErr);
    }
  }

  const { error: updErr } = await supabase
    .from('newsletter_issues')
    .update({
      status: 'published',
      published_at: nowIso,
      sanity_document_id: sanityPublishedId,
      resend_broadcast_id: resendBroadcastId,
      web_preview_url: archiveUrl,
      carousel_urls: carouselUrls,
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

  const result = {
    issue_id: input.issueId,
    archive_url: archiveUrl,
    sanity_document_id: sanityPublishedId,
    resend_broadcast_id: resendBroadcastId,
    linkedin_post_id: linkedinPostId,
    x_post_id: xPostId,
  };
  success('publishNewsletterIssue', result);
  return result;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue */
function buildNewsletterSocialPost(issue, archiveUrl) {
  const firstFeature = issue.panels.find((p) => p.kind === 'feature');
  const hook = firstFeature?.headline ?? issue.title;
  return `${issue.title} is out.\n\n${hook}\n\nRead the full issue → ${archiveUrl}`;
}
