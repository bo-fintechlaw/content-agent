import { writeAgentCorrection } from '../corrections/agentCorrections.js';

/**
 * Handle Slack block_actions for newsletter_issue_draft buttons.
 * Wire from your agent service: POST /slack/interactions → handleNewsletterSlackInteraction.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   actionId: string,
 *   issueId: string,
 *   slackUserId: string,
 *   contentAgentBaseUrl: string,
 *   newsletterTaskSecret?: string,
 * }} args
 */
export async function handleNewsletterApprove(supabase, args) {
  const { error: actionErr } = await supabase
    .from('agent_actions')
    .update({
      status: 'approved',
      resolved_at: new Date().toISOString(),
      resolved_by: args.slackUserId,
    })
    .eq('id', args.actionId);
  if (actionErr) throw new Error(actionErr.message);

  const { error: issueErr } = await supabase
    .from('newsletter_issues')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', args.issueId);
  if (issueErr) throw new Error(issueErr.message);

  const headers = { 'Content-Type': 'application/json' };
  if (args.newsletterTaskSecret) {
    headers['X-Newsletter-Task-Token'] = args.newsletterTaskSecret;
  }

  const res = await fetch(
    `${args.contentAgentBaseUrl.replace(/\/+$/, '')}/api/tasks/publish-newsletter-issue`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ issue_id: args.issueId }),
    }
  );
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `publish failed HTTP ${res.status}`);
  }
  return body;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   actionId: string,
 *   issueId: string,
 *   slackUserId: string,
 *   feedback?: string,
 * }} args
 */
export async function handleNewsletterDiscard(supabase, args) {
  const { error: actionErr } = await supabase
    .from('agent_actions')
    .update({
      status: 'discarded',
      resolved_at: new Date().toISOString(),
      resolved_by: args.slackUserId,
    })
    .eq('id', args.actionId);
  if (actionErr) throw new Error(actionErr.message);

  const { error: issueErr } = await supabase
    .from('newsletter_issues')
    .update({ status: 'discarded', updated_at: new Date().toISOString() })
    .eq('id', args.issueId);
  if (issueErr) throw new Error(issueErr.message);

  return { discarded: true, issue_id: args.issueId };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   actionId: string,
 *   issueId: string,
 *   slackUserId: string,
 *   note?: string,
 * }} args
 */
export async function handleNewsletterEditRequest(supabase, args) {
  await writeAgentCorrection(supabase, {
    actionId: args.actionId,
    kind: 'newsletter_issue_edit',
    proposed: { issue_id: args.issueId },
    corrected: {
      issue_id: args.issueId,
      note: args.note ?? 'Bo requested edits via Slack',
      requested_by: args.slackUserId,
    },
    editorId: args.slackUserId,
  });

  const { error: actionErr } = await supabase
    .from('agent_actions')
    .update({
      status: 'edit_requested',
      resolved_at: new Date().toISOString(),
      resolved_by: args.slackUserId,
    })
    .eq('id', args.actionId);
  if (actionErr) throw new Error(actionErr.message);

  return { edit_requested: true, issue_id: args.issueId };
}

/**
 * Dispatch a Slack interaction payload (block_actions) for newsletter cards.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   payload: { actions?: Array<{ action_id: string, value?: string }>, user?: { id: string } },
 *   contentAgentBaseUrl: string,
 *   newsletterTaskSecret?: string,
 * }} args
 */
export async function handleNewsletterSlackInteraction(supabase, args) {
  const action = args.payload?.actions?.[0];
  if (!action?.value) return null;

  const parsed = JSON.parse(action.value);
  const slackUserId = args.payload?.user?.id ?? 'unknown';
  const base = {
    actionId: parsed.actionId,
    issueId: parsed.issueId,
    slackUserId,
  };

  switch (action.action_id) {
    case 'approve_newsletter_issue':
      return handleNewsletterApprove(supabase, {
        ...base,
        contentAgentBaseUrl: args.contentAgentBaseUrl,
        newsletterTaskSecret: args.newsletterTaskSecret,
      });
    case 'discard_newsletter_issue':
      return handleNewsletterDiscard(supabase, base);
    case 'edit_newsletter_issue':
      return handleNewsletterEditRequest(supabase, base);
    default:
      return null;
  }
}
