import express from 'express';
import { renderNewsletterIssue } from '../pipeline/newsletter-renderer.js';
import { publishNewsletterIssue } from '../pipeline/newsletter-publisher.js';
import { lintNewsletterIssue } from '../utils/newsletter-compliance-linter.js';
import { verifyNewsletterClaims, verifyNewsletterCitations } from '../utils/newsletter-verify.js';
import { buildNewsletterPreviewHtml } from '../utils/newsletter-preview-html.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * Task endpoints for CMO delegation (render_newsletter_issue / publish).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} config
 */
export function createNewsletterTaskRouter(supabase, config) {
  const router = express.Router();

  function checkTaskAuth(req, res) {
    const secret = config.NEWSLETTER_TASK_SECRET;
    if (!secret) {
      res.status(503).json({
        ok: false,
        error: 'Newsletter task auth not configured (set NEWSLETTER_TASK_SECRET)',
      });
      return false;
    }
    const token =
      req.get('X-Newsletter-Task-Token') ||
      req.query.token ||
      req.body?.token;
    if (String(token) !== String(secret)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return false;
    }
    return true;
  }

  router.post('/tasks/render-newsletter-issue', async (req, res) => {
    start('POST /api/tasks/render-newsletter-issue');
    try {
      if (!checkTaskAuth(req, res)) return;
      const issueJson = req.body?.issue_json ?? req.body?.issueJson;
      const taskId = req.body?.task_id ?? req.body?.taskId ?? null;
      if (!issueJson) {
        return res.status(400).json({ ok: false, error: 'issue_json required' });
      }
      const lint = lintNewsletterIssue(issueJson);
      if (!lint.pass) {
        return res.status(422).json({ ok: false, error: 'compliance_linter', violations: lint.violations });
      }
      const output = await renderNewsletterIssue(supabase, config, { issueJson, taskId });
      success('POST /api/tasks/render-newsletter-issue', { issueId: output.issue_id });
      res.json({ ok: true, ...output });
    } catch (error) {
      fail('POST /api/tasks/render-newsletter-issue', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/tasks/publish-newsletter-issue', async (req, res) => {
    start('POST /api/tasks/publish-newsletter-issue');
    try {
      if (!checkTaskAuth(req, res)) return;
      const issueId = req.body?.issue_id ?? req.body?.issueId;
      if (!issueId) {
        return res.status(400).json({ ok: false, error: 'issue_id required' });
      }
      const output = await publishNewsletterIssue(supabase, config, { issueId });
      success('POST /api/tasks/publish-newsletter-issue', { issueId });
      res.json({ ok: true, ...output });
    } catch (error) {
      fail('POST /api/tasks/publish-newsletter-issue', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/newsletter/lint', async (req, res) => {
    const issueJson = req.body?.issue_json ?? req.body;
    const lint = lintNewsletterIssue(issueJson);
    res.json({ ok: lint.pass, violations: lint.violations });
  });

  router.post('/newsletter/verify-claims', async (req, res) => {
    start('POST /api/newsletter/verify-claims');
    try {
      const issueJson = req.body?.issue_json ?? req.body;
      const result = await verifyNewsletterClaims(config, issueJson);
      success('POST /api/newsletter/verify-claims', { ok: result.ok });
      res.json(result);
    } catch (error) {
      fail('POST /api/newsletter/verify-claims', error);
      res.status(500).json({ ok: false, violations: [error.message] });
    }
  });

  router.post('/newsletter/verify-citations', async (req, res) => {
    start('POST /api/newsletter/verify-citations');
    try {
      const issueJson = req.body?.issue_json ?? req.body;
      const result = await verifyNewsletterCitations(config, issueJson);
      success('POST /api/newsletter/verify-citations', { ok: result.ok });
      res.json(result);
    } catch (error) {
      fail('POST /api/newsletter/verify-citations', error);
      res.status(500).json({ ok: false, violations: [error.message] });
    }
  });

  router.get('/newsletter-issues/:id/preview', async (req, res) => {
    start('GET /api/newsletter-issues/:id/preview');
    try {
      const issueId = String(req.params.id ?? '').trim();
      if (!issueId) return res.status(400).send('Missing issue id');

      const { data, error } = await supabase
        .from('newsletter_issues')
        .select('id, status, issue_json')
        .eq('id', issueId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.issue_json) return res.status(404).send('Newsletter issue not found');

      const html = buildNewsletterPreviewHtml(data.issue_json, {
        issueId: data.id,
        status: data.status,
      });
      success('GET /api/newsletter-issues/:id/preview', { issueId });
      return res.status(200).type('html').send(html);
    } catch (error) {
      fail('GET /api/newsletter-issues/:id/preview', error);
      return res.status(500).send(`Preview unavailable: ${error.message}`);
    }
  });

  return router;
}
