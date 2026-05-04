import { fail, start, success } from '../utils/logger.js';
import { postLinkedInUgc } from '../integrations/linkedin.js';
import { postXTweet } from '../integrations/x.js';
import { createSlackClient, sendStatusMessage } from '../integrations/slack.js';

async function notifySlack(config, text) {
  if (!config?.SLACK_BOT_TOKEN || !config?.SLACK_CHANNEL_ID) return;
  try {
    const slack = createSlackClient(config.SLACK_BOT_TOKEN);
    await sendStatusMessage(slack, config.SLACK_CHANNEL_ID, text);
  } catch (slackErr) {
    fail('runSocialPosting:slack', slackErr);
  }
}

/**
 * Stage 8: post approved/published content to LinkedIn + X.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 */
export async function runSocialPosting(supabase, config, options = {}) {
  start('runSocialPosting');
  const dryRun = !!options.dryRun;

  const maxPerRun = config.ORCHESTRATION_MAX_SOCIAL ?? 3;

  const { data: topics, error: topicsErr } = await supabase
    .from('content_topics')
    .select('id,status')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
    .limit(maxPerRun);

  if (topicsErr) throw new Error(topicsErr.message);

  const topicIds = (topics ?? []).map((t) => t.id);
  if (!topicIds.length) {
    success('runSocialPosting', { posted: 0, reason: 'no_published_topics' });
    return { posted: 0, reason: 'no_published_topics' };
  }

  const { data: drafts, error: draftsErr } = await supabase
    .from('content_drafts')
    .select(
      'id,topic_id,blog_title,blog_slug,linkedin_post,x_post,x_thread,sanity_document_id,linkedin_post_id,x_post_id,social_approved'
    )
    .in('topic_id', topicIds)
    .not('sanity_document_id', 'is', null)
    .eq('social_approved', true)
    .order('created_at', { ascending: false })
    .limit(maxPerRun * 2);

  if (draftsErr) throw new Error(draftsErr.message);

  let postedLinkedIn = 0;
  let postedX = 0;
  let skipped = 0;

  const SITE_BASE_URL = 'https://fintechlaw.ai/blog';

  for (const draft of drafts ?? []) {
    const blogUrl = draft.blog_slug ? `${SITE_BASE_URL}/${draft.blog_slug}` : '';
    const linkedinText = appendBlogLink(draft.linkedin_post ?? '', blogUrl);
    const xText = appendBlogLink(draft.x_post ?? '', blogUrl);
    const xThread = Array.isArray(draft.x_thread) ? draft.x_thread : [];

    const hasLinkedIn = !!linkedinText && !draft.linkedin_post_id;
    const hasX = !!config.ENABLE_X_POSTING && !!xText && !draft.x_post_id;

    if (!hasLinkedIn && !hasX) {
      skipped++;
      continue;
    }

    let newLinkedInId = null;
    let newXId = null;

    // Each platform gets its own try/catch so a LinkedIn failure does not
    // prevent the X post (and vice versa), and so we can emit per-platform
    // Slack confirmations / errors.
    if (hasLinkedIn) {
      if (!config.LINKEDIN_ACCESS_TOKEN || !config.LINKEDIN_PERSON_URN) {
        skipped++;
      } else if (dryRun) {
        skipped++;
      } else {
        try {
          const { id } = await postLinkedInUgc({
            accessToken: config.LINKEDIN_ACCESS_TOKEN,
            personUrn: config.LINKEDIN_PERSON_URN,
            text: linkedinText,
          });
          newLinkedInId = id;
          await supabase
            .from('content_drafts')
            .update({ linkedin_post_id: id })
            .eq('id', draft.id);
          postedLinkedIn++;
          const liUrl = `https://www.linkedin.com/feed/update/${id}/`;
          await notifySlack(config, `:briefcase: LinkedIn posted: ${liUrl}`);
        } catch (linkedInErr) {
          fail('runSocialPosting:linkedin', linkedInErr, { draftId: draft.id });
          await notifySlack(
            config,
            `:x: LinkedIn post failed for "${draft.blog_title || draft.id}": ${
              linkedInErr?.message || 'unknown error'
            }`
          );
        }
      }
    }

    if (hasX) {
      if (
        !config.X_API_KEY ||
        !config.X_API_SECRET ||
        !config.X_ACCESS_TOKEN ||
        !config.X_ACCESS_TOKEN_SECRET
      ) {
        skipped++;
      } else if (dryRun) {
        skipped++;
      } else {
        try {
          const { id: firstTweetId } = await postXTweet({
            consumerKey: config.X_API_KEY,
            consumerSecret: config.X_API_SECRET,
            accessToken: config.X_ACCESS_TOKEN,
            accessTokenSecret: config.X_ACCESS_TOKEN_SECRET,
            text: xText,
          });

          let replyTo = firstTweetId;
          for (const threadText of xThread.slice(0, 4)) {
            if (!threadText) continue;
            const { id: replyId } = await postXTweet({
              consumerKey: config.X_API_KEY,
              consumerSecret: config.X_API_SECRET,
              accessToken: config.X_ACCESS_TOKEN,
              accessTokenSecret: config.X_ACCESS_TOKEN_SECRET,
              text: threadText,
              inReplyToTweetId: replyTo,
            });
            replyTo = replyId;
          }

          newXId = firstTweetId;
          await supabase
            .from('content_drafts')
            .update({ x_post_id: firstTweetId })
            .eq('id', draft.id);
          postedX++;
          const xUrl = `https://x.com/i/web/status/${firstTweetId}`;
          await notifySlack(config, `:bird: X posted: ${xUrl}`);
        } catch (xErr) {
          fail('runSocialPosting:x', xErr, { draftId: draft.id });
          await notifySlack(
            config,
            `:x: X post failed for "${draft.blog_title || draft.id}": ${
              xErr?.message || 'unknown error'
            }`
          );
        }
      }
    }

    // Analytics (best-effort): store raw ids from this run.
    if (!dryRun) {
      if (newLinkedInId) {
        try {
          await supabase.from('content_analytics').insert({
            draft_id: draft.id,
            platform: 'linkedin',
            impressions: 0,
            engagements: 0,
            raw_data: { linkedin_post_id: newLinkedInId },
          });
        } catch {
          // Non-fatal analytics failure.
        }
      }
      if (newXId) {
        try {
          await supabase.from('content_analytics').insert({
            draft_id: draft.id,
            platform: 'x',
            impressions: 0,
            engagements: 0,
            raw_data: { x_post_id: newXId },
          });
        } catch {
          // Non-fatal analytics failure.
        }
      }
    }
  }

  success('runSocialPosting', {
    postedLinkedIn,
    postedX,
    skipped,
  });

  return { postedLinkedIn, postedX, skipped };
}

function appendBlogLink(text, blogUrl) {
  if (!text || !blogUrl) return text;
  // Don't duplicate if the URL is already in the text
  if (text.includes(blogUrl)) return text;
  return `${text}\n\n${blogUrl}`;
}

