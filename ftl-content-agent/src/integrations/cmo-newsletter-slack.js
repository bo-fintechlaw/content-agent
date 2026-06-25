import { Client as NotionClient } from '@notionhq/client';
import { createFleetSupabaseClient } from '../db/supabase.js';
import { createSlackClient, sendStatusMessage } from './slack.js';
import { generateNewsletterLinkedInPost } from '../pipeline/newsletter-social-generator.js';
import { postNewsletterSocial } from '../pipeline/newsletter-social-poster.js';
import { fail, start, success } from '../utils/logger.js';

const NEWSLETTER_ACTIONS = new Set([
  'approve_newsletter_issue',
  'discard_newsletter_issue',
  'edit_newsletter_issue',
]);

const NEWSLETTER_SOCIAL_ACTIONS = new Set([
  'approve_newsletter_social',
  'request_changes_newsletter_social',
  'reject_newsletter_social',
]);

/**
 * @param {string} actionId
 */
export function isNewsletterSlackAction(actionId) {
  return NEWSLETTER_ACTIONS.has(actionId) || NEWSLETTER_SOCIAL_ACTIONS.has(actionId);
}

/**
 * @param {import('../config/env.js').validateEnv extends () => infer R ? R : never} config
 */
export function fleetSupabaseFromConfig(config) {
  return createFleetSupabaseClient(config);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} fleetSupabase
 * @param {string} issueId
 */
async function loadNewsletterIssueRow(fleetSupabase, issueId) {
  const { data, error } = await fleetSupabase
    .from('newsletter_issues')
    .select('id, status, linkedin_post_id')
    .eq('id', issueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('newsletter issue not found');
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} fleetSupabase
 * @param {string | undefined} actionId
 */
async function assertAgentActionProposed(fleetSupabase, actionId) {
  if (!actionId) return;
  const { data, error } = await fleetSupabase
    .from('agent_actions')
    .select('id, status')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('agent action not found');
  if (data.status !== 'proposed') {
    throw new Error(`stale agent action (status=${data.status})`);
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} fleetSupabase
 * @param {ReturnType<typeof import('../config/env.js').validateEnv>} config
 * @param {{ actions?: Array<{ action_id: string, value?: string }>, user?: { id: string }, trigger_id?: string }} payload
 */
export async function handleNewsletterSlackInteraction(fleetSupabase, config, payload) {
  const action = payload.actions?.[0];
  if (!action?.value) return null;

  const parsed = JSON.parse(action.value);
  const slackUserId = payload.user?.id ?? 'unknown';
  const base = {
    actionId: parsed.actionId,
    issueId: parsed.issueId,
    slackUserId,
    triggerId: payload.trigger_id,
  };

  switch (action.action_id) {
    case 'approve_newsletter_issue':
      return approveNewsletterIssue(fleetSupabase, config, base);
    case 'discard_newsletter_issue':
      return discardNewsletterIssue(fleetSupabase, base);
    case 'edit_newsletter_issue':
      return requestNewsletterEdit(fleetSupabase, base);
    case 'approve_newsletter_social':
      return approveNewsletterSocial(fleetSupabase, config, base);
    case 'request_changes_newsletter_social':
      return requestNewsletterSocialChanges(fleetSupabase, config, base);
    case 'reject_newsletter_social':
      return rejectNewsletterSocial(fleetSupabase, base);
    default:
      return null;
  }
}

/**
 * Gate 2 — LinkedIn social review card after publish.
 * @param {import('@slack/web-api').WebClient} client
 * @param {string} channel
 * @param {{ issueId: string, title: string, archiveUrl: string, carouselUrls: string[], linkedinPost: string }} payload
 */
export async function sendNewsletterSocialReviewCard(client, channel, payload) {
  start('sendNewsletterSocialReviewCard', { issueId: payload.issueId });

  const carouselPreview = payload.carouselRenderError
    ? `_Carousel render failed: ${payload.carouselRenderError}_`
    : payload.carouselUrls?.[0]
      ? `<${payload.carouselUrls[0]}|Panel 1> · ${payload.carouselUrls.length} carousel panels`
      : '_No carousel images generated._';

  const actionValue = JSON.stringify({ issueId: payload.issueId });

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Newsletter Social — LinkedIn Review', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${payload.title}*\nArchive: <${payload.archiveUrl}|View issue>\nCarousel: ${carouselPreview}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*LinkedIn post copy (full)*\n${String(payload.linkedinPost ?? '').slice(0, 2800)}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve & Post to LinkedIn' },
          style: 'primary',
          action_id: 'approve_newsletter_social',
          value: actionValue,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Request Changes' },
          action_id: 'request_changes_newsletter_social',
          value: actionValue,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Skip Social' },
          style: 'danger',
          action_id: 'reject_newsletter_social',
          value: actionValue,
        },
      ],
    },
  ];

  const result = await client.chat.postMessage({
    channel,
    text: `Newsletter social review: ${payload.title}`,
    blocks,
  });
  success('sendNewsletterSocialReviewCard', { issueId: payload.issueId, ts: result.ts });
  return result;
}

async function approveNewsletterIssue(fleetSupabase, config, args) {
  start('approveNewsletterIssue', { issueId: args.issueId });

  const issue = await loadNewsletterIssueRow(fleetSupabase, args.issueId);
  if (issue.status === 'published') {
    return { already_published: true, issue_id: args.issueId };
  }
  if (issue.status === 'discarded') {
    throw new Error('Cannot approve a discarded newsletter issue');
  }
  if (issue.status !== 'review') {
    throw new Error(`Cannot approve newsletter issue in status=${issue.status}`);
  }
  await assertAgentActionProposed(fleetSupabase, args.actionId);

  if (args.actionId) {
    const { error: actionErr } = await fleetSupabase
      .from('agent_actions')
      .update({
        status: 'approved',
        updated_at: new Date().toISOString(),
        user_id: args.slackUserId,
      })
      .eq('id', args.actionId);
    if (actionErr) throw new Error(actionErr.message);
  }

  const { error: issueErr } = await fleetSupabase
    .from('newsletter_issues')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', args.issueId);
  if (issueErr) throw new Error(issueErr.message);

  const headers = { 'Content-Type': 'application/json' };
  if (config.NEWSLETTER_TASK_SECRET) {
    headers['X-Newsletter-Task-Token'] = config.NEWSLETTER_TASK_SECRET;
  }

  const baseUrl = (config.APP_BASE_URL || '').replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/api/tasks/publish-newsletter-issue`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ issue_id: args.issueId }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `publish failed HTTP ${res.status}`);
  }

  await markPublicationPublished(fleetSupabase, config, args.issueId);

  const channelId = config.SLACK_CMO_BO_CHANNEL_ID || config.SLACK_CHANNEL_ID;
  if (config.SLACK_BOT_TOKEN && channelId) {
    try {
      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendStatusMessage(
        slack,
        channelId,
        `:white_check_mark: Newsletter approved and published (issue \`${args.issueId}\`). LinkedIn social card posted for Gate 2 review.`
      );
    } catch (slackErr) {
      fail('approveNewsletterIssue:slack', slackErr);
    }
  }

  success('approveNewsletterIssue', { issueId: args.issueId });
  return body;
}

async function approveNewsletterSocial(fleetSupabase, config, args) {
  start('approveNewsletterSocial', { issueId: args.issueId });
  const issue = await loadNewsletterIssueRow(fleetSupabase, args.issueId);
  if (issue.status !== 'published') {
    throw new Error(`Cannot approve social when issue status=${issue.status}`);
  }
  if (issue.linkedin_post_id) {
    return { linkedin_post_id: issue.linkedin_post_id, skipped: true, issue_id: args.issueId };
  }
  const result = await postNewsletterSocial(fleetSupabase, config, { issueId: args.issueId });

  const channelId = config.SLACK_CMO_BO_CHANNEL_ID || config.SLACK_CHANNEL_ID;
  if (config.SLACK_BOT_TOKEN && channelId) {
    try {
      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendStatusMessage(
        slack,
        channelId,
        `:linkedin: Newsletter LinkedIn carousel posted (issue \`${args.issueId}\`, post \`${result.linkedin_post_id ?? 'n/a'}\`).`
      );
    } catch (slackErr) {
      fail('approveNewsletterSocial:slack', slackErr);
    }
  }

  success('approveNewsletterSocial', { issueId: args.issueId });
  return result;
}

async function requestNewsletterSocialChanges(fleetSupabase, config, args) {
  start('requestNewsletterSocialChanges', { issueId: args.issueId });
  const issue = await loadNewsletterIssueRow(fleetSupabase, args.issueId);
  if (issue.status !== 'published') {
    throw new Error(`Cannot request social changes when issue status=${issue.status}`);
  }
  if (!args.triggerId || !config.SLACK_BOT_TOKEN) {
    throw new Error('Missing Slack trigger for feedback modal');
  }

  const slack = createSlackClient(config.SLACK_BOT_TOKEN);
  await slack.views.open({
    trigger_id: args.triggerId,
    view: {
      type: 'modal',
      callback_id: 'newsletter_social_feedback_modal',
      private_metadata: JSON.stringify({ issueId: args.issueId }),
      title: { type: 'plain_text', text: 'Revise LinkedIn Copy' },
      submit: { type: 'plain_text', text: 'Regenerate' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'feedback_block',
          label: { type: 'plain_text', text: 'What should change in the LinkedIn post?' },
          element: {
            type: 'plain_text_input',
            action_id: 'feedback_text',
            multiline: true,
          },
        },
      ],
    },
  });

  return { edit_requested: true, issue_id: args.issueId };
}

/**
 * Handle modal submission for newsletter social feedback.
 * @param {import('@supabase/supabase-js').SupabaseClient} fleetSupabase
 * @param {Record<string, unknown>} config
 * @param {{ issueId: string, feedback: string }} input
 */
export async function regenerateNewsletterSocialCard(fleetSupabase, config, input) {
  start('regenerateNewsletterSocialCard', { issueId: input.issueId });

  const { data: row, error } = await fleetSupabase
    .from('newsletter_issues')
    .select('id, issue_json, carousel_urls, web_preview_url')
    .eq('id', input.issueId)
    .single();
  if (error) throw new Error(error.message);

  const issue = row.issue_json;
  const archiveUrl =
    row.web_preview_url ?? `https://fintechlaw.ai/newsletters/${issue?.slug ?? ''}`;
  const linkedinPost = await generateNewsletterLinkedInPost(config, {
    issue,
    archiveUrl,
    feedback: input.feedback,
  });

  await fleetSupabase
    .from('newsletter_issues')
    .update({
      linkedin_post: linkedinPost,
      social_approved: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.issueId);

  const channelId = config.SLACK_CMO_BO_CHANNEL_ID || config.SLACK_CHANNEL_ID;
  if (config.SLACK_BOT_TOKEN && channelId) {
    const slack = createSlackClient(config.SLACK_BOT_TOKEN);
    await sendNewsletterSocialReviewCard(slack, channelId, {
      issueId: input.issueId,
      title: issue.title,
      archiveUrl,
      carouselUrls: row.carousel_urls ?? [],
      linkedinPost,
    });
  }

  success('regenerateNewsletterSocialCard', { issueId: input.issueId });
  return { linkedin_post: linkedinPost };
}

async function rejectNewsletterSocial(fleetSupabase, args) {
  start('rejectNewsletterSocial', { issueId: args.issueId });
  const issue = await loadNewsletterIssueRow(fleetSupabase, args.issueId);
  if (issue.status !== 'published') {
    throw new Error(`Cannot skip social when issue status=${issue.status}`);
  }
  await fleetSupabase
    .from('newsletter_issues')
    .update({
      social_approved: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.issueId);
  return { social_skipped: true, issue_id: args.issueId };
}

async function discardNewsletterIssue(fleetSupabase, args) {
  const issue = await loadNewsletterIssueRow(fleetSupabase, args.issueId);
  if (issue.status === 'discarded') {
    return { already_discarded: true, issue_id: args.issueId };
  }
  if (issue.status === 'published') {
    throw new Error('Cannot discard a published newsletter issue');
  }
  if (issue.status !== 'review') {
    throw new Error(`Cannot discard newsletter issue in status=${issue.status}`);
  }
  await assertAgentActionProposed(fleetSupabase, args.actionId);

  const { error: actionErr } = await fleetSupabase
    .from('agent_actions')
    .update({
      status: 'rejected',
      updated_at: new Date().toISOString(),
      user_id: args.slackUserId,
    })
    .eq('id', args.actionId);
  if (actionErr) throw new Error(actionErr.message);

  const { error: issueErr } = await fleetSupabase
    .from('newsletter_issues')
    .update({ status: 'discarded', updated_at: new Date().toISOString() })
    .eq('id', args.issueId);
  if (issueErr) throw new Error(issueErr.message);

  return { discarded: true, issue_id: args.issueId };
}

async function requestNewsletterEdit(fleetSupabase, args) {
  const issue = await loadNewsletterIssueRow(fleetSupabase, args.issueId);
  if (issue.status === 'published' || issue.status === 'discarded') {
    throw new Error(`Cannot edit newsletter issue in status=${issue.status}`);
  }
  if (issue.status !== 'review') {
    throw new Error(`Cannot edit newsletter issue in status=${issue.status}`);
  }
  await assertAgentActionProposed(fleetSupabase, args.actionId);

  const { error: actionErr } = await fleetSupabase
    .from('agent_actions')
    .update({
      status: 'proposed',
      updated_at: new Date().toISOString(),
      user_id: args.slackUserId,
    })
    .eq('id', args.actionId);
  if (actionErr) throw new Error(actionErr.message);

  return { edit_requested: true, issue_id: args.issueId };
}

async function markPublicationPublished(fleetSupabase, config, issueId) {
  const now = new Date().toISOString();
  const { data: row, error: fetchErr } = await fleetSupabase
    .from('newsletter_publications')
    .select('id, notion_page_id')
    .eq('newsletter_issue_id', issueId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!row) return;

  const { error: updateErr } = await fleetSupabase
    .from('newsletter_publications')
    .update({ status: 'published', updated_at: now })
    .eq('id', row.id);
  if (updateErr) throw new Error(updateErr.message);

  if (config.NOTION_TOKEN && row.notion_page_id) {
    try {
      const notion = new NotionClient({ auth: config.NOTION_TOKEN });
      await notion.pages.update({
        page_id: row.notion_page_id,
        properties: {
          Status: { status: { name: 'Published' } },
          Notes: {
            rich_text: [{ text: { content: `Approved and published — issue ${issueId}` } }],
          },
        },
      });
    } catch (notionErr) {
      fail('markPublicationPublished:notion', notionErr, { issueId });
    }
  }
}
