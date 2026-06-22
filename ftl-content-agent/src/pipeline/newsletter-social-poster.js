import { postLinkedInCarousel, postLinkedInUgc } from '../integrations/linkedin.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * Post approved newsletter social content to LinkedIn.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} config
 * @param {{ issueId: string }} input
 */
export async function postNewsletterSocial(supabase, config, input) {
  start('postNewsletterSocial', { issueId: input.issueId });

  const { data: row, error } = await supabase
    .from('newsletter_issues')
    .select('id, issue_json, carousel_urls, linkedin_post, linkedin_post_id, web_preview_url')
    .eq('id', input.issueId)
    .single();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('newsletter issue not found');
  if (row.linkedin_post_id) {
    return { linkedin_post_id: row.linkedin_post_id, skipped: true };
  }

  const text = row.linkedin_post ?? '';
  const carouselUrls = Array.isArray(row.carousel_urls) ? row.carousel_urls : [];
  const archiveUrl =
    row.web_preview_url ??
    `https://fintechlaw.ai/newsletters/${row.issue_json?.slug ?? ''}`;

  let linkedinPostId = null;

  if (config.LINKEDIN_ACCESS_TOKEN && config.LINKEDIN_PERSON_URN && text) {
    try {
      if (carouselUrls.length) {
        const { id } = await postLinkedInCarousel({
          accessToken: config.LINKEDIN_ACCESS_TOKEN,
          personUrn: config.LINKEDIN_PERSON_URN,
          text,
          imageUrls: carouselUrls,
        });
        linkedinPostId = id;
      } else {
        const { id } = await postLinkedInUgc({
          accessToken: config.LINKEDIN_ACCESS_TOKEN,
          personUrn: config.LINKEDIN_PERSON_URN,
          text: `${text}\n\n${archiveUrl}`,
        });
        linkedinPostId = id;
      }
    } catch (liErr) {
      fail('postNewsletterSocial:linkedin', liErr);
      if (carouselUrls.length) {
        try {
          const { id } = await postLinkedInUgc({
            accessToken: config.LINKEDIN_ACCESS_TOKEN,
            personUrn: config.LINKEDIN_PERSON_URN,
            text: `${text}\n\n${archiveUrl}`,
          });
          linkedinPostId = id;
        } catch (fallbackErr) {
          fail('postNewsletterSocial:linkedinFallback', fallbackErr);
          throw fallbackErr;
        }
      } else {
        throw liErr;
      }
    }
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from('newsletter_issues')
    .update({
      linkedin_post_id: linkedinPostId,
      social_approved: true,
      updated_at: nowIso,
    })
    .eq('id', input.issueId);

  if (linkedinPostId) {
    await supabase.from('issue_metrics').upsert(
      {
        newsletter_issue_id: input.issueId,
        platform: 'linkedin',
        metric_kind: 'post_published',
        value: 1,
        metadata: { linkedin_post_id: linkedinPostId },
        idem_key: `linkedin-post-${linkedinPostId}`,
      },
      { onConflict: 'idem_key' }
    );
  }

  success('postNewsletterSocial', { issueId: input.issueId, linkedinPostId });
  return { linkedin_post_id: linkedinPostId };
}
