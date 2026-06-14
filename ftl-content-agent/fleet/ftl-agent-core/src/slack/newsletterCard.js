/**
 * Build Slack Block Kit card for newsletter_issue_draft (Approve / Edit / Discard).
 * @param {{
 *   actionId: string,
 *   issueId: string,
 *   title: string,
 *   webPreviewUrl: string,
 *   emailTestId?: string,
 *   carouselUrls?: string[],
 * }} payload
 */
export function buildNewsletterIssueDraftCard(payload) {
  const carouselLine =
    payload.carouselUrls?.length
      ? payload.carouselUrls.map((u, i) => `<${u}|Panel ${i + 1}>`).join(' · ')
      : '_Carousel previews pending_';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Newsletter Issue Draft', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${payload.title}*\n` +
          `*Web preview:* <${payload.webPreviewUrl}|Open archive preview>\n` +
          (payload.emailTestId ? `*Test email:* \`${payload.emailTestId}\`\n` : '') +
          `*Carousel:* ${carouselLine}`,
      },
    },
    {
      type: 'actions',
      block_id: `newsletter_action_${payload.actionId}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          action_id: 'approve_newsletter_issue',
          value: JSON.stringify({ actionId: payload.actionId, issueId: payload.issueId }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit' },
          action_id: 'edit_newsletter_issue',
          value: JSON.stringify({ actionId: payload.actionId, issueId: payload.issueId }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Discard' },
          style: 'danger',
          action_id: 'discard_newsletter_issue',
          value: JSON.stringify({ actionId: payload.actionId, issueId: payload.issueId }),
        },
      ],
    },
  ];
}
