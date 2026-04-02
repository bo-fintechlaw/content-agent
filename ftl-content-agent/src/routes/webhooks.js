import crypto from 'crypto';
import express from 'express';
import { fail, start, success } from '../utils/logger.js';
import { publishDraftToSanity } from '../pipeline/publisher.js';
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
          await openFeedbackModal(slack, payload.trigger_id, draftId);
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

  const { draftId } = JSON.parse(payload.view.private_metadata ?? '{}');
  const feedback =
    payload.view.state?.values?.feedback_block?.feedback_text?.value ?? '';

  if (!draftId || !feedback.trim()) {
    return res.status(200).json({ response_action: 'clear' });
  }

  try {
    // Reset the draft for revision with the human feedback
    const { data: draft, error: fetchErr } = await supabase
      .from('content_drafts')
      .select('id, topic_id, revision_count, judge_flags')
      .eq('id', draftId)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);

    const existingFlags = Array.isArray(draft.judge_flags) ? draft.judge_flags : [];

    await supabase
      .from('content_drafts')
      .update({
        judge_pass: null,
        judge_scores: null,
        revision_count: (draft.revision_count ?? 0) + 1,
        judge_flags: [...existingFlags, `human_feedback: ${feedback.trim()}`],
      })
      .eq('id', draftId);

    await supabase
      .from('content_topics')
      .update({ status: 'revision', updated_at: new Date().toISOString() })
      .eq('id', draft.topic_id);

    success('handleViewSubmission', { draftId, feedback: feedback.slice(0, 100) });
  } catch (error) {
    fail('handleViewSubmission', error);
  }

  return res.status(200).json({ response_action: 'clear' });
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
