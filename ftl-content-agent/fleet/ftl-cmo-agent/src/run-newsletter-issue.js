import { createClient } from '@supabase/supabase-js';
import {
  delegateToAgent,
  reportBack,
  createAgentAction,
  postNewsletterIssueDraftCard,
} from '../../ftl-agent-core/src/index.js';
import { getDueNewsletterSegment } from './notion-calendar.js';
import { selectBlogPostsForSegment } from './blog-selector.js';
import { assembleIssueJson } from './issue-writer.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Full CMO newsletter loop: calendar → assemble → delegate → Slack card.
 * @param {{ segment?: string }} options
 */
export async function runNewsletterIssue(options = {}) {
  const config = loadConfig();
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

  const calendar =
    options.segment != null
      ? { segment: options.segment, source: 'cli' }
      : await getDueNewsletterSegment(
          config.NOTION_DB_CONTENT_CALENDAR,
          config.NOTION_TOKEN
        );

  const segment = calendar.segment;
  const posts = await selectBlogPostsForSegment(supabase, segment, { limit: 3 });
  if (posts.length < 2) {
    throw new Error(`Not enough published posts for segment=${segment} (found ${posts.length})`);
  }

  const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const issueJson = await assembleIssueJson(anthropic, config, { segment, posts });

  const lintRes = await fetch(`${config.CONTENT_AGENT_BASE_URL}/api/newsletter/lint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(issueJson),
  });
  const lintBody = await lintRes.json();
  if (!lintBody.ok) {
    throw new Error(`Compliance linter failed: ${(lintBody.violations ?? []).join('; ')}`);
  }

  const { task_id: taskId } = await delegateToAgent(supabase, {
    fromAgent: 'cmo',
    toAgent: 'content',
    kind: 'render_newsletter_issue',
    payload: { issue_json: issueJson },
  });

  const renderRes = await fetch(
    `${config.CONTENT_AGENT_BASE_URL}/api/tasks/render-newsletter-issue`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Newsletter-Task-Token': config.NEWSLETTER_TASK_SECRET,
      },
      body: JSON.stringify({ issue_json: issueJson, task_id: taskId }),
    }
  );
  const renderBody = await renderRes.json();
  if (!renderRes.ok || !renderBody.ok) {
    throw new Error(renderBody.error ?? `render failed HTTP ${renderRes.status}`);
  }

  await reportBack(supabase, {
    taskId,
    result: renderBody,
    status: 'done',
  });

  const action = await createAgentAction(supabase, {
    agentId: 'cmo',
    kind: 'newsletter_issue_draft',
    payload: {
      issue_id: renderBody.issue_id,
      issue_json: issueJson,
      render: renderBody,
    },
    autonomyLevel: 'shadow',
    gateChannelId: config.SLACK_CMO_BO_CHANNEL_ID,
  });

  if (config.SLACK_BOT_TOKEN) {
    await postNewsletterIssueDraftCard({
      token: config.SLACK_BOT_TOKEN,
      channelId: config.SLACK_CMO_BO_CHANNEL_ID,
      payload: {
        actionId: action.id,
        issueId: renderBody.issue_id,
        title: issueJson.title,
        webPreviewUrl: renderBody.web_preview_url,
        emailTestId: renderBody.email_test_id,
        carouselUrls: renderBody.carousel_urls,
      },
    });
  }

  return {
    segment,
    calendar_source: calendar.source,
    task_id: taskId,
    action_id: action.id,
    issue_json: issueJson,
    render: renderBody,
  };
}

function loadConfig() {
  const required = [
    'ANTHROPIC_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'CONTENT_AGENT_BASE_URL',
  ];
  for (const key of required) {
    if (!process.env[key]?.trim()) throw new Error(`Missing ${key}`);
  }
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    CONTENT_AGENT_BASE_URL: process.env.CONTENT_AGENT_BASE_URL.replace(/\/+$/, ''),
    NEWSLETTER_TASK_SECRET: process.env.NEWSLETTER_TASK_SECRET || '',
    SLACK_CMO_BO_CHANNEL_ID: process.env.SLACK_CMO_BO_CHANNEL_ID || 'C0BB9U7AN0Y',
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || '',
    NOTION_TOKEN: process.env.NOTION_TOKEN || '',
    NOTION_DB_CONTENT_CALENDAR: process.env.NOTION_DB_CONTENT_CALENDAR || '',
  };
}
