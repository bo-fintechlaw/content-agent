import { WebClient } from '@slack/web-api';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('slack');

export function createSlackClient(token) {
  start('createSlackClient');
  try {
    const client = new WebClient(token);
    success('createSlackClient');
    return client;
  } catch (error) {
    fail('createSlackClient', error);
    throw error;
  }
}

export async function sendReviewMessage(client, channel, payload) {
  start('sendReviewMessage');
  const channelId = normalizeChannelId(channel);

  // Build blog body preview (first ~500 chars)
  const bodyPreview = buildBodyPreview(payload.blogBody, 500);
  const linkedinPreview = payload.linkedinPost
    ? truncate(payload.linkedinPost, 300)
    : null;
  const xPreview = payload.xPost || null;

  const verdict = payload.verdict ?? (payload.scores ? 'PASS' : '');
  const composite = payload.composite ?? '';
  const statusLabel = verdict === 'PASS'
    ? 'Ready for approval'
    : 'Needs review — see judge notes';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'New Blog Draft for Review', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${payload.blog_title}*` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Composite Score:* ${composite}/10  |  *Status:* ${statusLabel}\n` +
          `Accuracy: ${payload.scores.accuracy}/10  |  ` +
          `Engagement: ${payload.scores.engagement}/10  |  ` +
          `SEO: ${payload.scores.seo}/10\n` +
          `Voice: ${payload.scores.voice}/10  |  ` +
          `Structure: ${payload.scores.structure ?? 'N/A'}/10`,
      },
    },
  ];

  // Judge notes for drafts that did not fully pass
  if (payload.revisionNotes && Array.isArray(payload.revisionNotes) && payload.revisionNotes.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Judge Notes:*\n${payload.revisionNotes.map(n => `- ${truncate(n, 200)}`).join('\n')}`,
      },
    });
  }

  // Blog body preview
  if (bodyPreview) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Blog Preview*\n${bodyPreview}`,
      },
    });
  }

  // LinkedIn preview
  if (linkedinPreview) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*LinkedIn Post*\n${linkedinPreview}`,
      },
    });
  }

  // X preview
  if (xPreview) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*X Post*\n${xPreview}`,
      },
    });
  }

  // Action buttons
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Approve' },
        style: 'primary',
        action_id: 'approve_draft',
        value: payload.draftId,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Request Changes' },
        action_id: 'request_changes_draft',
        value: payload.draftId,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Reject' },
        style: 'danger',
        action_id: 'reject_draft',
        value: payload.draftId,
      },
    ],
  });

  const result = await breaker.execute(
    () =>
      client.chat.postMessage({
        channel: channelId,
        text: `Content ready for review: ${payload.blog_title}`,
        blocks,
      }),
    { ok: false, error: 'slack_unavailable' }
  );
  if (!result.ok) {
    const err = new Error(String(result.error ?? 'slack_post_failed'));
    fail('sendReviewMessage', err, { channel, channelId });
  } else {
    success('sendReviewMessage', { ts: result.ts });
  }
  return result;
}

export async function sendSocialReviewMessage(client, channel, payload) {
  start('sendSocialReviewMessage');
  const channelId = normalizeChannelId(channel);

  const linkedinPreview = payload.linkedinPost
    ? truncate(payload.linkedinPost, 500)
    : '_No LinkedIn post generated._';
  const xPreview = payload.xPost || '_No X post generated._';
  const xThreadPreview = Array.isArray(payload.xThread) && payload.xThread.length
    ? payload.xThread.map((t, i) => `${i + 1}. ${truncate(t, 200)}`).join('\n')
    : null;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Social Posts Ready for Review', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Blog published: *${payload.blogTitle}*\nNow review the social media posts before they go live.`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*LinkedIn Post*\n${linkedinPreview}` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*X Post*\n${xPreview}` },
    },
  ];

  if (xThreadPreview) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*X Thread*\n${xThreadPreview}` },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Approve Social Posts' },
        style: 'primary',
        action_id: 'approve_social',
        value: payload.draftId,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Request Changes' },
        action_id: 'request_changes_social',
        value: payload.draftId,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Skip Social' },
        style: 'danger',
        action_id: 'reject_social',
        value: payload.draftId,
      },
    ],
  });

  const result = await breaker.execute(
    () =>
      client.chat.postMessage({
        channel: channelId,
        text: `Social posts ready for review: ${payload.blogTitle}`,
        blocks,
      }),
    { ok: false, error: 'slack_unavailable' }
  );
  if (!result.ok) {
    const err = new Error(String(result.error ?? 'slack_social_review_failed'));
    fail('sendSocialReviewMessage', err, { channel, channelId });
  } else {
    success('sendSocialReviewMessage', { ts: result.ts });
  }
  return result;
}

export async function openFeedbackModal(client, triggerId, draftId) {
  start('openFeedbackModal');
  try {
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'feedback_modal',
        private_metadata: JSON.stringify({ draftId }),
        title: { type: 'plain_text', text: 'Request Changes' },
        submit: { type: 'plain_text', text: 'Submit Feedback' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'feedback_block',
            label: { type: 'plain_text', text: 'What changes are needed?' },
            element: {
              type: 'plain_text_input',
              action_id: 'feedback_text',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'e.g., "Make the intro more engaging", "Add a section about compliance deadlines", "Tone is too formal"',
              },
            },
          },
        ],
      },
    });
    success('openFeedbackModal');
  } catch (error) {
    fail('openFeedbackModal', error);
    throw error;
  }
}

function buildBodyPreview(blogBody, maxChars) {
  if (!blogBody || !Array.isArray(blogBody)) return null;
  let preview = '';
  for (const section of blogBody) {
    if (preview.length >= maxChars) break;
    if (section.title) preview += `*${section.title}*\n`;
    if (section.body) preview += section.body + '\n\n';
  }
  return truncate(preview.trim(), maxChars);
}

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function normalizeChannelId(channel) {
  const raw = String(channel ?? '').trim();
  if (/^[CG][A-Z0-9]{8,}$/i.test(raw)) return raw;
  const match = raw.match(/([CG][A-Z0-9]{8,})/i);
  if (match?.[1]) return match[1];
  return raw;
}
