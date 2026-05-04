import crypto from 'crypto';
import express from 'express';
import { fail, start, success } from '../utils/logger.js';
import { publishDraftToSanity } from '../pipeline/publisher.js';
import { reviseSocialContent } from '../pipeline/social-reviser.js';
import { reviseBlogContent } from '../pipeline/blog-reviser.js';
import { runJudging } from '../pipeline/judge.js';
import { createSlackClient, openFeedbackModal, sendSocialReviewMessage } from '../integrations/slack.js';

export function createSlackWebhookRouter(supabase, config) {
  const router = express.Router();

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
          publishDraftToSanity(supabase, config, draftId)
            .then(async () => {
              // After successful Sanity publish, send social posts for review
              try {
                const { data: draft } = await supabase
                  .from('content_drafts')
                  .select('id, blog_title, linkedin_post, x_post, x_thread')
                  .eq('id', draftId)
                  .single();
                if (draft) {
                  const slack = createSlackClient(config.SLACK_BOT_TOKEN);
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
        } else if (actionId === 'reject_social') {
          await supabase
            .from('content_drafts')
            .update({ social_approved: false })
            .eq('id', draftId);
        } else if (actionId === 'request_changes_social') {
          const slack = createSlackClient(config.SLACK_BOT_TOKEN);
          await openFeedbackModal(slack, payload.trigger_id, draftId, 'social');
        } else if (actionId === 'reject_draft') {
          await setTopicStatusFromDraft(supabase, draftId, 'rejected');
        } else if (actionId === 'request_changes_draft') {
          const slack = createSlackClient(config.SLACK_BOT_TOKEN);
          await openFeedbackModal(slack, payload.trigger_id, draftId);
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
    }
    return;
  }

  // Blog feedback: targeted revision in place. The reviser updates only the
  // sections the feedback addresses; the rest of the draft (and the existing
  // image asset) is preserved. Then re-judge so the new Slack review shows
  // fresh scores. Topic status stays at `review` throughout so the drafter
  // cron does NOT pick it up for a full redraft.
  res.status(200).json({ response_action: 'clear' });

  try {
    await reviseBlogContent(supabase, config, draftId, feedback.trim());
    await runJudging(supabase, config, { draftId });
    success('handleViewSubmission:blog', {
      draftId,
      feedback: feedback.slice(0, 100),
    });
  } catch (error) {
    fail('handleViewSubmission:blog', error, { draftId });
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
