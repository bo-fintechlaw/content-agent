import crypto from 'crypto';
import express from 'express';
import { fail, start, success } from '../utils/logger.js';
import { publishDraftToSanity } from '../pipeline/publisher.js';
import { reviseSocialContent } from '../pipeline/social-reviser.js';
import { reviseBlogContent } from '../pipeline/blog-reviser.js';
import { runJudging } from '../pipeline/judge.js';
import { runDrafting } from '../pipeline/drafter.js';
import {
  createSlackClient,
  openFeedbackModal,
  sendSocialReviewMessage,
  sendStatusMessage,
} from '../integrations/slack.js';

export function createSlackWebhookRouter(supabase, config) {
  const router = express.Router();

  // Slack slash commands (e.g., `/suggest`). Slack expects the request URL
  // to live at /slack/commands per app config; we route by `command` field
  // so a single endpoint can dispatch to multiple commands later.
  router.post(
    '/commands',
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
    async (req, res) => {
      start('POST /slack/commands');
      try {
        if (!verifySlackRequest(req, config.SLACK_SIGNING_SECRET)) {
          return res.status(401).json({ ok: false });
        }
        const command = String(req.body.command ?? '').trim();
        const text = String(req.body.text ?? '').trim();
        const userId = String(req.body.user_id ?? '').trim();
        const responseUrl = String(req.body.response_url ?? '').trim();

        if (command !== '/suggest') {
          return res.status(200).json({
            response_type: 'ephemeral',
            text: `Unsupported slash command: ${command || '(empty)'}`,
          });
        }

        if (!text) {
          return res.status(200).json({
            response_type: 'ephemeral',
            text:
              'Usage: `/suggest <url>` to suggest a story by URL, or `/suggest <free text>` to suggest a topic in plain language. The agent picks up new suggestions on the next 7 AM ET drafter cron.',
          });
        }

        // Acknowledge immediately so Slack doesn't time out (3s budget).
        // The actual topic insert + URL metadata fetch runs async; results
        // post back to the same channel via response_url.
        res.status(200).json({
          response_type: 'ephemeral',
          text: ':inbox_tray: Got your suggestion — processing…',
        });

        processSuggestionInBackground({
          supabase,
          text,
          userId,
          responseUrl,
        }).catch((err) => fail('processSuggestion', err));
      } catch (error) {
        fail('POST /slack/commands', error);
        try {
          if (!res.headersSent) {
            res
              .status(200)
              .json({ response_type: 'ephemeral', text: `Error: ${error.message}` });
          }
        } catch (sendErr) {
          fail('POST /slack/commands:send', sendErr);
        }
      }
    }
  );

  async function processSuggestionInBackground({ supabase, text, userId, responseUrl }) {
    start('processSuggestion', { user: userId, textPreview: text.slice(0, 80) });

    const url = extractFirstUrl(text);
    let title = '';
    let summary = '';
    let metaSource = '';
    if (url) {
      const meta = await fetchUrlMeta(url).catch(() => null);
      if (meta?.title) {
        title = meta.title;
        metaSource = 'fetched';
      }
      if (meta?.description) {
        summary = meta.description;
      }
      if (!title) {
        title = humanizeUrl(url);
        metaSource = 'url_fallback';
      }
    } else {
      // Free-text suggestion: title is the first sentence (truncated), full
      // text becomes the summary so the drafter has the context.
      const firstSentence = text.split(/[.!?\n]/)[0].trim();
      title = (firstSentence || text).slice(0, 200);
      summary = text;
      metaSource = 'free_text';
    }

    const row = {
      title: title.slice(0, 500),
      source_url: url || null,
      source_name: 'manual_suggestion',
      summary: summary?.slice(0, 2000) || null,
      category: 'startup',
      relevance_score: 10.0,
      status: 'ranked',
      suggested_by: 'manual',
    };

    const { data, error } = await supabase
      .from('content_topics')
      .insert(row)
      .select('id, title, status, source_url')
      .single();

    if (error) {
      fail('processSuggestion:insert', error);
      await postToSlackResponseUrl(responseUrl, {
        response_type: 'ephemeral',
        text: `:x: Could not save the suggestion: ${error.message}`,
      });
      return;
    }

    success('processSuggestion', { id: data.id, metaSource });

    const headerLines = [
      ':white_check_mark: Suggestion saved.',
      `*Title:* ${data.title}`,
    ];
    if (data.source_url) headerLines.push(`*URL:* ${data.source_url}`);
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: headerLines.join('\n') } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Draft now' },
            style: 'primary',
            action_id: 'draft_topic_now',
            value: data.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Wait for next cron (7 AM ET)' },
            action_id: 'wait_for_cron',
            value: data.id,
          },
        ],
      },
    ];
    if (metaSource === 'url_fallback') {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '_Could not fetch the page title — used the URL as a fallback. Edit later if needed._',
          },
        ],
      });
    }
    await postToSlackResponseUrl(responseUrl, {
      response_type: 'ephemeral',
      replace_original: true,
      text: 'Suggestion saved — choose Draft now or wait for the next cron.',
      blocks,
    });
  }

  router.post(
    '/interactions',
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
    async (req, res) => {
      start('POST /slack/interactions');
      try {
        if (!verifySlackRequest(req, config.SLACK_SIGNING_SECRET)) {
          return res.status(401).json({ ok: false });
        }
        const payload = JSON.parse(req.body.payload ?? '{}');

        // Handle modal submissions (feedback form)
        if (payload.type === 'view_submission') {
          return await handleViewSubmission(supabase, config, payload, res);
        }

        // Handle button clicks
        const action = payload.actions?.[0];
        const draftId = action?.value;
        const actionId = action?.action_id;
        if (!draftId || !actionId) return res.status(200).json({ ok: true });

        if (actionId === 'approve_draft') {
          // Human approval is the override for any judge verdict (REVISE/REJECT
          // included). Flip judge_pass=true so the orchestrator's autopublish
          // gate is satisfied; otherwise an approved-but-judge-failed draft
          // would sit indefinitely. Autonomous mode still keys off the judge's
          // own judge_pass=true on PASS — this just lets a human override.
          await supabase
            .from('content_drafts')
            .update({ judge_pass: true })
            .eq('id', draftId);
          await setTopicStatusFromDraft(supabase, draftId, 'approved');
          const ackSlack = createSlackClient(config.SLACK_BOT_TOKEN);
          try {
            await sendStatusMessage(
              ackSlack,
              config.SLACK_CHANNEL_ID,
              ':white_check_mark: Approved — publishing to Sanity…'
            );
          } catch (slackErr) {
            fail('approveAck', slackErr, { draftId });
          }
          publishDraftToSanity(supabase, config, draftId)
            .then(async () => {
              try {
                const { data: draft } = await supabase
                  .from('content_drafts')
                  .select('id, blog_title, blog_slug, linkedin_post, x_post, x_thread')
                  .eq('id', draftId)
                  .single();
                if (draft) {
                  const slack = createSlackClient(config.SLACK_BOT_TOKEN);
                  const blogUrl = draft.blog_slug
                    ? `https://fintechlaw.ai/blog/${draft.blog_slug}`
                    : '';
                  try {
                    await sendStatusMessage(
                      slack,
                      config.SLACK_CHANNEL_ID,
                      blogUrl
                        ? `:memo: Published: ${blogUrl}`
                        : ':memo: Published to Sanity (slug missing — check live site).'
                    );
                  } catch (statusErr) {
                    fail('publishConfirm', statusErr, { draftId });
                  }
                  await sendSocialReviewMessage(slack, config.SLACK_CHANNEL_ID, {
                    draftId: draft.id,
                    blogTitle: draft.blog_title,
                    linkedinPost: draft.linkedin_post,
                    xPost: draft.x_post,
                    xThread: draft.x_thread,
                  });
                }
              } catch (socialErr) {
                fail('sendSocialReviewAfterPublish', socialErr);
              }
            })
            .catch(async (error) => {
              fail('publishDraftToSanity', error);
              try {
                const slack = createSlackClient(config.SLACK_BOT_TOKEN);
                await sendStatusMessage(
                  slack,
                  config.SLACK_CHANNEL_ID,
                  `:x: Publish failed: ${error?.message || 'unknown error'}. Topic reset to review — try again.`
                );
              } catch (statusErr) {
                fail('publishFailNotice', statusErr, { draftId });
              }
              try {
                await setTopicStatusFromDraft(supabase, draftId, 'review');
              } catch (statusErr) {
                fail('publishDraftToSanity:statusUpdate', statusErr);
              }
            });
        } else if (actionId === 'approve_social') {
          await supabase
            .from('content_drafts')
            .update({ social_approved: true })
            .eq('id', draftId);
          try {
            const slack = createSlackClient(config.SLACK_BOT_TOKEN);
            await sendStatusMessage(
              slack,
              config.SLACK_CHANNEL_ID,
              ':white_check_mark: Social approved — will post on the next orchestrator tick (every 15 min).'
            );
          } catch (slackErr) {
            fail('approveSocialAck', slackErr, { draftId });
          }
        } else if (actionId === 'reject_social') {
          await supabase
            .from('content_drafts')
            .update({ social_approved: false })
            .eq('id', draftId);
          try {
            const slack = createSlackClient(config.SLACK_BOT_TOKEN);
            await sendStatusMessage(
              slack,
              config.SLACK_CHANNEL_ID,
              ':x: Social rejected — will not post.'
            );
          } catch (slackErr) {
            fail('rejectSocialAck', slackErr, { draftId });
          }
        } else if (actionId === 'request_changes_social') {
          const slack = createSlackClient(config.SLACK_BOT_TOKEN);
          await openFeedbackModal(slack, payload.trigger_id, draftId, 'social');
        } else if (actionId === 'reject_draft') {
          await setTopicStatusFromDraft(supabase, draftId, 'rejected');
          try {
            const slack = createSlackClient(config.SLACK_BOT_TOKEN);
            await sendStatusMessage(
              slack,
              config.SLACK_CHANNEL_ID,
              ':x: Draft rejected — topic moved to rejected status; no further action will be taken.'
            );
          } catch (slackErr) {
            fail('rejectDraftAck', slackErr, { draftId });
          }
        } else if (actionId === 'request_changes_draft') {
          const slack = createSlackClient(config.SLACK_BOT_TOKEN);
          await openFeedbackModal(slack, payload.trigger_id, draftId);
        } else if (actionId === 'draft_topic_now') {
          // `value` here is a topic_id (not a draft_id) — set by the /suggest
          // confirmation message. Kick off draft + judge async so we ack the
          // button click inside Slack's 3s budget; the judge will post the
          // normal review buttons to the channel when it passes.
          const topicId = action.value;
          const respUrl = payload.response_url;
          if (respUrl) {
            await postToSlackResponseUrl(respUrl, {
              response_type: 'ephemeral',
              replace_original: true,
              text: ':hourglass_flowing_sand: Drafting now — review will appear in the channel shortly.',
            });
          }
          (async () => {
            try {
              const result = await runDrafting(supabase, config, { topicId });
              if (result?.drafted && result?.draftId) {
                await runJudging(supabase, config, { draftId: result.draftId });
              } else {
                const slack = createSlackClient(config.SLACK_BOT_TOKEN);
                await sendStatusMessage(
                  slack,
                  config.SLACK_CHANNEL_ID,
                  `:warning: Could not draft topic ${topicId}: ${result?.reason || 'unknown'}.`
                );
              }
            } catch (err) {
              fail('draft_topic_now', err, { topicId });
              try {
                const slack = createSlackClient(config.SLACK_BOT_TOKEN);
                await sendStatusMessage(
                  slack,
                  config.SLACK_CHANNEL_ID,
                  `:x: Immediate draft failed: ${err?.message || 'unknown error'}.`
                );
              } catch (statusErr) {
                fail('draft_topic_now:status', statusErr);
              }
            }
          })();
        } else if (actionId === 'wait_for_cron') {
          if (payload.response_url) {
            await postToSlackResponseUrl(payload.response_url, {
              response_type: 'ephemeral',
              replace_original: true,
              text: ':alarm_clock: Queued — this topic will be drafted on the next 7 AM ET cron.',
            });
          }
        }

        success('POST /slack/interactions', { actionId, draftId });
        return res.status(200).json({ ok: true });
      } catch (error) {
        fail('POST /slack/interactions', error);
        return res.status(500).json({ ok: false, error: error.message });
      }
    }
  );

  return router;
}

async function handleViewSubmission(supabase, config, payload, res) {
  if (payload.view?.callback_id !== 'feedback_modal') {
    return res.status(200).json({ response_action: 'clear' });
  }

  const { draftId, context } = JSON.parse(payload.view.private_metadata ?? '{}');
  const feedback =
    payload.view.state?.values?.feedback_block?.feedback_text?.value ?? '';

  if (!draftId || !feedback.trim()) {
    return res.status(200).json({ response_action: 'clear' });
  }

  // Social feedback: regenerate social posts and resend review message
  if (context === 'social') {
    // Respond to Slack immediately, then process async
    res.status(200).json({ response_action: 'clear' });

    // Ack into the channel so the reviewer sees the system received their
    // instructions before the social reviser finishes (which can take 20-60s).
    try {
      const ackSlack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendStatusMessage(
        ackSlack,
        config.SLACK_CHANNEL_ID,
        `:hourglass_flowing_sand: Social feedback received — regenerating posts… (\`${feedback.trim().slice(0, 140)}\`)`
      );
    } catch (slackErr) {
      fail('handleViewSubmission:social:ack', slackErr, { draftId });
    }

    try {
      const revised = await reviseSocialContent(supabase, config, draftId, feedback.trim());

      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendSocialReviewMessage(slack, config.SLACK_CHANNEL_ID, {
        draftId,
        blogTitle: revised.blogTitle,
        linkedinPost: revised.linkedinPost,
        xPost: revised.xPost,
        xThread: revised.xThread,
      });

      success('handleViewSubmission:social', { draftId, feedback: feedback.slice(0, 100) });
    } catch (error) {
      fail('handleViewSubmission:social', error);
      try {
        const slack = createSlackClient(config.SLACK_BOT_TOKEN);
        await sendStatusMessage(
          slack,
          config.SLACK_CHANNEL_ID,
          `:x: Social revision failed: ${error?.message || 'unknown error'}.`
        );
      } catch (statusErr) {
        fail('handleViewSubmission:social:failMsg', statusErr, { draftId });
      }
    }
    return;
  }

  // Blog feedback: targeted revision in place. The reviser updates only the
  // sections the feedback addresses; the rest of the draft (and the existing
  // image asset) is preserved. Then re-judge so the new Slack review shows
  // fresh scores. Topic status stays at `review` throughout so the drafter
  // cron does NOT pick it up for a full redraft.
  res.status(200).json({ response_action: 'clear' });

  // Ack into the channel so the reviewer sees the system received their
  // feedback before the surgical reviser + judge cycle finishes (1-3 min).
  try {
    const ackSlack = createSlackClient(config.SLACK_BOT_TOKEN);
    await sendStatusMessage(
      ackSlack,
      config.SLACK_CHANNEL_ID,
      `:hourglass_flowing_sand: Feedback received — applying surgical revision and re-judging… (\`${feedback.trim().slice(0, 140)}\`)`
    );
  } catch (slackErr) {
    fail('handleViewSubmission:blog:ack', slackErr, { draftId });
  }

  try {
    await reviseBlogContent(supabase, config, draftId, feedback.trim());
    await runJudging(supabase, config, { draftId });
    success('handleViewSubmission:blog', {
      draftId,
      feedback: feedback.slice(0, 100),
    });
  } catch (error) {
    fail('handleViewSubmission:blog', error, { draftId });
    try {
      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendStatusMessage(
        slack,
        config.SLACK_CHANNEL_ID,
        `:x: Revision failed: ${error?.message || 'unknown error'}. The original draft is still in \`review\` — try again or use the buttons above.`
      );
    } catch (statusErr) {
      fail('handleViewSubmission:blog:failMsg', statusErr, { draftId });
    }
  }
  return;
}

function verifySlackRequest(req, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp || !req.rawBody) return false;
  const base = `v0:${timestamp}:${req.rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  const expected = `v0=${hmac}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function setTopicStatusFromDraft(supabase, draftId, status) {
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('id, topic_id')
    .eq('id', draftId)
    .single();
  if (error) throw new Error(error.message);
  const { error: upErr } = await supabase
    .from('content_topics')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', draft.topic_id);
  if (upErr) throw new Error(upErr.message);
}

function extractFirstUrl(text) {
  // Slack auto-wraps URLs as <url|display> or <url>. Strip those wrappers
  // first so the regex below doesn't choke on the angle brackets.
  const unwrapped = String(text ?? '').replace(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g, '$1');
  const match = unwrapped.match(/https?:\/\/[^\s)]+/);
  if (!match) return null;
  // Trim trailing punctuation that often follows a URL in chat ("(", ".", ",").
  return match[0].replace(/[.,;:!?)\]'"]+$/g, '');
}

async function fetchUrlMeta(url) {
  // Best-effort metadata pull: 5s timeout, follow redirects, give up on
  // anything non-2xx. Parse the first <title>...</title> and the first
  // og:description / meta description we find. The drafter prompt will
  // re-read the URL itself when it builds the post; we're just trying
  // to surface a meaningful title for the human reviewer to recognize.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; FTLContentAgent/1.0; +https://fintechlaw.ai)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!r.ok) return null;
    const html = await r.text();
    return parseHtmlMeta(html);
  } finally {
    clearTimeout(t);
  }
}

function parseHtmlMeta(html) {
  const head = String(html).slice(0, 50_000); // cap to head + a bit
  const titleMatch =
    head.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    head.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
    head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch =
    head.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const decode = (s) =>
    String(s ?? '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  return {
    title: decode(titleMatch?.[1]).slice(0, 250) || null,
    description: decode(descMatch?.[1]).slice(0, 500) || null,
  };
}

function humanizeUrl(url) {
  try {
    const u = new URL(url);
    const slug = u.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop() ?? '';
    if (slug) {
      return `${u.hostname}: ${slug.replace(/[-_]+/g, ' ').slice(0, 200)}`;
    }
    return u.hostname;
  } catch {
    return url.slice(0, 200);
  }
}

async function postToSlackResponseUrl(responseUrl, body) {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail('postToSlackResponseUrl', err);
  }
}
