import { createSanityClient } from '../integrations/sanity.js';
import { createResendClient, sendNewsletterEmail } from '../integrations/resend.js';
import {
  buildNewsletterEmailHtml,
  buildNewsletterEmailText,
} from '../emails/newsletter-issue-html.js';
import { parseIssueJson } from '../schemas/newsletter.js';
import { lintNewsletterIssue } from '../utils/newsletter-compliance-linter.js';
import { verifyNewsletterBlogLinks } from '../utils/newsletter-link-verifier.js';
import { fail, start, success } from '../utils/logger.js';

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
  const webPreviewUrl = archiveUrl;

  let sanityDocumentId = null;
  if (config.SANITY_PROJECT_ID && config.SANITY_API_TOKEN) {
    const client = createSanityClient(config);
    const doc = buildNewsletterSanityDocument(issue);
    const created = await client.create({ ...doc, _id: `drafts.newsletter-${issue.slug}` });
    sanityDocumentId = created?._id ?? null;
  }

  let emailTestId = null;
  if (config.RESEND_API_KEY && config.NEWSLETTER_TEST_EMAIL) {
    const resend = createResendClient(config.RESEND_API_KEY);
    const html = buildNewsletterEmailHtml(issue, {
      archiveUrl,
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

  const carouselUrls = buildCarouselPlaceholders(issue);

  const row = {
    title: issue.title,
    segment: issue.segment,
    issue_date: issue.issue_date,
    slug: issue.slug,
    issue_json: issue,
    status: 'review',
    agent_task_id: input.taskId ?? null,
    sanity_document_id: sanityDocumentId,
    web_preview_url: webPreviewUrl,
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

  const output = {
    issue_id: data.id,
    web_preview_url: webPreviewUrl,
    email_test_id: emailTestId,
    carousel_urls: carouselUrls,
    sanity_document_id: sanityDocumentId,
  };

  success('renderNewsletterIssue', output);
  return output;
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue */
function buildCarouselPlaceholders(issue) {
  return issue.panels.map(
    (p, i) => `${PUBLIC_SITE}/api/newsletter/carousel/${issue.slug}/panel-${i + 1}.png`
  );
}
