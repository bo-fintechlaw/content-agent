import { createResendClient, sendNewsletterEmail } from '../integrations/resend.js';
import {
  buildNewsletterEmailHtml,
  buildNewsletterEmailText,
} from '../emails/newsletter-issue-html.js';
import { parseIssueJson } from '../schemas/newsletter.js';
import { lintNewsletterIssue } from '../utils/newsletter-compliance-linter.js';
import { verifyNewsletterBlogLinks } from '../utils/newsletter-link-verifier.js';
import { newsletterIssuePreviewUrl } from '../utils/newsletter-preview-url.js';
import { start, success } from '../utils/logger.js';

const PUBLIC_SITE = 'https://fintechlaw.ai';

/**
 * Build a Sanity draft document for a newsletter issue (preview).
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 */
export function buildNewsletterSanityDocument(issue) {
  return {
    _type: 'newsletter',
    title: issue.title,
    slug: { _type: 'slug', current: issue.slug },
    issueDate: issue.issue_date,
    segment: issue.segment,
    intro: issue.intro,
    toc: issue.toc,
    panels: issue.panels,
    authorName: issue.author.name,
    authorTitle: issue.author.title,
    footerDisclaimer: issue.footer.disclaimer,
    subscribeUrl: issue.footer.subscribe_url,
  };
}

/**
 * render_newsletter_issue task — Sanity preview, test email, carousel URLs.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} config
 * @param {{ issueJson: unknown, taskId?: string }} input
 */
export async function renderNewsletterIssue(supabase, config, input) {
  start('renderNewsletterIssue', { taskId: input?.taskId });

  const issue = parseIssueJson(input.issueJson);
  const lint = lintNewsletterIssue(issue);
  if (!lint.pass) {
    throw new Error(`Compliance linter failed: ${lint.violations.join('; ')}`);
  }

  const linkCheck = await verifyNewsletterBlogLinks(issue);
  if (!linkCheck.pass) {
    const detail = linkCheck.failures.map((f) => `${f.url}: ${f.reason}`).join('; ');
    throw new Error(`Blog link verification failed: ${detail}`);
  }

  const archiveUrl = `${PUBLIC_SITE}/newsletter/${issue.slug}`;

  // Draft review uses content-agent HTML preview — not the public archive URL.
  let sanityDocumentId = null;

  let emailTestId = null;
  if (config.RESEND_API_KEY && config.NEWSLETTER_TEST_EMAIL) {
    const previewPlaceholder = '[preview link in Slack]';
    const resend = createResendClient(config.RESEND_API_KEY);
    const html = buildNewsletterEmailHtml(issue, {
      archiveUrl: previewPlaceholder,
      unsubscribeUrl: `${PUBLIC_SITE}/unsubscribe`,
    });
    const text = buildNewsletterEmailText(issue, {
      archiveUrl,
      unsubscribeUrl: `${PUBLIC_SITE}/unsubscribe`,
    });
    const sent = await sendNewsletterEmail(resend, {
      from: config.RESEND_FROM_EMAIL || 'FinTech Law <newsletter@fintechlaw.ai>',
      to: [config.NEWSLETTER_TEST_EMAIL],
      subject: `[TEST] ${issue.title} — ${issue.issue_date}`,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${PUBLIC_SITE}/unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    emailTestId = sent?.id ?? null;
  }

  // Carousel PNGs are generated at publish time for LinkedIn — not linked during draft review.
  const carouselUrls = [];

  const row = {
    title: issue.title,
    segment: issue.segment,
    issue_date: issue.issue_date,
    slug: issue.slug,
    issue_json: issue,
    status: 'review',
    agent_task_id: input.taskId ?? null,
    sanity_document_id: sanityDocumentId,
    web_preview_url: null,
    email_test_id: emailTestId,
    carousel_urls: carouselUrls,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('newsletter_issues')
    .upsert(row, { onConflict: 'slug' })
    .select('id')
    .single();

  if (error) throw new Error(`newsletter_issues upsert failed: ${error.message}`);

  const webPreviewUrl = newsletterIssuePreviewUrl(config, data.id);
  if (!webPreviewUrl) {
    throw new Error(
      'APP_BASE_URL is required on content-agent so Slack draft preview links resolve (e.g. Railway public domain).'
    );
  }

  const { error: previewErr } = await supabase
    .from('newsletter_issues')
    .update({ web_preview_url: webPreviewUrl, updated_at: new Date().toISOString() })
    .eq('id', data.id);
  if (previewErr) throw new Error(previewErr.message);

  const output = {
    issue_id: data.id,
    web_preview_url: webPreviewUrl,
    email_test_id: emailTestId,
    carousel_urls: carouselUrls,
    sanity_document_id: sanityDocumentId,
    archive_url_pending: archiveUrl,
  };

  success('renderNewsletterIssue', output);
  return output;
}
