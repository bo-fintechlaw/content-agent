import { Client as NotionClient } from '@notionhq/client';
import { createFleetSupabaseClient } from '../db/supabase.js';
import { createSlackClient, sendStatusMessage } from './slack.js';
import { fail, start, success } from '../utils/logger.js';

const NEWSLETTER_ACTIONS = new Set([
  'approve_newsletter_issue',
  'discard_newsletter_issue',
  'edit_newsletter_issue',
]);

/**
 * @param {string} actionId
 */
export function isNewsletterSlackAction(actionId) {
  return NEWSLETTER_ACTIONS.has(actionId);
}

/**
 * @param {import('../config/env.js').validateEnv extends () => infer R ? R : never} config
 */
export function fleetSupabaseFromConfig(config) {
  return createFleetSupabaseClient(config);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} fleetSupabase
 * @param {ReturnType<typeof import('../config/env.js').validateEnv>} config
 * @param {{ actions?: Array<{ action_id: string, value?: string }>, user?: { id: string } }} payload
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
  };

  switch (action.action_id) {
    case 'approve_newsletter_issue':
      return approveNewsletterIssue(fleetSupabase, config, base);
    case 'discard_newsletter_issue':
      return discardNewsletterIssue(fleetSupabase, base);
    case 'edit_newsletter_issue':
      return requestNewsletterEdit(fleetSupabase, base);
    default:
      return null;
  }
}

async function approveNewsletterIssue(fleetSupabase, config, args) {
  start('approveNewsletterIssue', { issueId: args.issueId });

  const { error: actionErr } = await fleetSupabase
    .from('agent_actions')
    .update({
      status: 'approved',
      updated_at: new Date().toISOString(),
      user_id: args.slackUserId,
    })
    .eq('id', args.actionId);
  if (actionErr) throw new Error(actionErr.message);

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
        `:white_check_mark: Newsletter approved and published (issue \`${args.issueId}\`).`
      );
    } catch (slackErr) {
      fail('approveNewsletterIssue:slack', slackErr);
    }
  }

  success('approveNewsletterIssue', { issueId: args.issueId });
  return body;
}

async function discardNewsletterIssue(fleetSupabase, args) {
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
