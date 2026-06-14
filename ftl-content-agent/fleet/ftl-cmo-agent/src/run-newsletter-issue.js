import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { NEWSLETTER_ASSEMBLY_SYSTEM } from './prompts/newsletter-assembly-system.js';
import { selectBlogPostsForSegment } from './blog-selector.js';

const PUBLIC_SITE = 'https://fintechlaw.ai';

/**
 * @param {{ segment?: 'financial_services' | 'tech_ai_legal' }} options
 */
export async function runNewsletterIssue(options = {}) {
  const segment = options.segment ?? 'financial_services';
  const config = loadConfig();

  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
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

  const renderRes = await fetch(
    `${config.CONTENT_AGENT_BASE_URL}/api/tasks/render-newsletter-issue`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Newsletter-Task-Token': config.NEWSLETTER_TASK_SECRET,
      },
      body: JSON.stringify({ issue_json: issueJson, task_id: crypto.randomUUID() }),
    }
  );
  const renderBody = await renderRes.json();
  if (!renderRes.ok || !renderBody.ok) {
    throw new Error(renderBody.error ?? `render failed HTTP ${renderRes.status}`);
  }

  // TODO(agent-core): write agent_action kind=newsletter_issue_draft to #cmo-bo
  return {
    segment,
    issue_json: issueJson,
    render: renderBody,
    slack_channel: config.SLACK_CMO_BO_CHANNEL_ID,
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
  };
}

/**
 * @param {Anthropic} anthropic
 * @param {Record<string, string>} config
 * @param {{ segment: string, posts: Array<Record<string, unknown>> }} ctx
 */
async function assembleIssueJson(anthropic, config, ctx) {
  const title =
    ctx.segment === 'financial_services' ? 'The Financial Edge' : 'The Startup Solution';
  const issueDate = new Date().toISOString().slice(0, 10);
  const slug = `${ctx.segment === 'financial_services' ? 'financial-edge' : 'startup-solution'}-${issueDate.slice(0, 7)}`;

  const userMessage = JSON.stringify({
    segment: ctx.segment,
    title,
    issue_date: issueDate,
    slug,
    posts: ctx.posts,
    instructions:
      'Return ONLY valid JSON matching the Issue JSON schema. Every feature must link to a live blog_url from posts.',
  });

  const response = await anthropic.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: NEWSLETTER_ASSEMBLY_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const jsonText = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(jsonText);
}
