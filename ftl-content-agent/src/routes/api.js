import express from 'express';
import { runDrafting } from '../pipeline/drafter.js';
import { runJudging } from '../pipeline/judge.js';
import { runDraftAndJudge } from '../pipeline/production.js';
import { runTopicRanking } from '../pipeline/ranker.js';
import { runSourceScan } from '../pipeline/scanner.js';
import { publishDraftToSanity } from '../pipeline/publisher.js';
import { runSocialPosting } from '../pipeline/social-poster.js';
import { reviseSocialContent } from '../pipeline/social-reviser.js';
import { runOrchestration } from '../pipeline/orchestrator.js';
import { runWeeklyReport } from '../pipeline/weekly-report.js';
import { createSlackClient, sendSocialReviewMessage } from '../integrations/slack.js';
import { checkSupabaseConnection } from '../db/supabase.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * API routes — Phase 1: health + stubs. Later: suggest-topic, topics, drafts.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 */
export function createApiRouter(supabaseClient, config) {
  const router = express.Router();

  router.get('/health', async (_req, res) => {
    start('GET /api/health');

    try {
      const db = await checkSupabaseConnection(supabaseClient);
      const timestamp = new Date().toISOString();
      const body = {
        status: 'ok',
        timestamp,
        uptimeSeconds: Math.floor(process.uptime()),
        database: db.connected
          ? { connected: true }
          : { connected: false, detail: db.error ?? 'check failed' },
      };
      const statusCode = db.connected ? 200 : 503;
      success('GET /api/health', { statusCode, dbConnected: db.connected });
      res.status(statusCode).json(body);
    } catch (error) {
      fail('GET /api/health', error);
      res.status(503).json({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: { connected: false, detail: error.message },
      });
    }
  });

  router.post('/suggest-topic', async (req, res) => {
    start('POST /api/suggest-topic');
    try {
      const { title, url, summary, category } = req.body ?? {};

      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ ok: false, error: 'Missing required field: title' });
      }

      const validCategories = ['regulatory', 'ai_legal_tech', 'startup', 'crypto'];
      const topicCategory = validCategories.includes(category) ? category : 'startup';

      const row = {
        title: title.trim(),
        source_url: url?.trim() || null,
        source_name: 'manual_suggestion',
        summary: summary?.trim() || null,
        category: topicCategory,
        relevance_score: 10.0,
        status: 'ranked',
        suggested_by: 'human',
      };

      const { data, error } = await supabaseClient
        .from('content_topics')
        .insert(row)
        .select('id, title, status, relevance_score')
        .single();

      if (error) throw new Error(error.message);

      success('POST /api/suggest-topic', { id: data.id });
      res.status(201).json({ ok: true, topic: data });
    } catch (error) {
      fail('POST /api/suggest-topic', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/topics', async (_req, res) => {
    start('GET /api/topics');

    try {
      const { data, error } = await supabaseClient
        .from('content_topics')
        .select(
          'id, source_url, source_name, title, summary, category, relevance_score, status, suggested_by, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw new Error(error.message);

      success('GET /api/topics', { count: data?.length ?? 0 });
      res.json({ ok: true, topics: data ?? [] });
    } catch (error) {
      fail('GET /api/topics', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/scan-now', async (_req, res) => {
    start('GET /api/scan-now');

    try {
      const stats = await runSourceScan(supabaseClient);
      success('GET /api/scan-now', stats);
      res.json({ ok: true, ...stats });
    } catch (error) {
      fail('GET /api/scan-now', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/rank-now', async (_req, res) => {
    start('GET /api/rank-now');
    try {
      const stats = await runTopicRanking(supabaseClient, config);
      success('GET /api/rank-now', stats);
      res.json({ ok: true, ...stats });
    } catch (error) {
      fail('GET /api/rank-now', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/draft-now', async (_req, res) => {
    start('GET /api/draft-now');
    try {
      const result = await runDrafting(supabaseClient, config);
      success('GET /api/draft-now', result);
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('GET /api/draft-now', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/judge-now', async (req, res) => {
    start('GET /api/judge-now');
    try {
      const draftId = String(req.query.draftId ?? '').trim();
      const result = await runJudging(
        supabaseClient,
        config,
        draftId ? { draftId } : undefined
      );
      success('GET /api/judge-now', result);
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('GET /api/judge-now', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  /** On-demand: draft a specific topic, then judge → Slack (no publish). Ignores the daily min score. */
  router.get('/start-production', async (req, res) => {
    start('GET /api/start-production');
    try {
      const secret = config.PRODUCTION_TRIGGER_SECRET;
      if (secret) {
        const token = String(
          req.query.token ?? req.headers['x-content-agent-token'] ?? ''
        ).trim();
        if (token !== secret) {
          res.status(401).json({ ok: false, error: 'Unauthorized' });
          return;
        }
      }
      const topicId = String(req.query.topicId ?? '').trim();
      if (!topicId) {
        res.status(400).json({ ok: false, error: 'Missing query param: topicId' });
        return;
      }
      const result = await runDraftAndJudge(supabaseClient, config, {
        topicId,
        runKind: 'on_demand',
      });
      success('GET /api/start-production', { topicId });
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('GET /api/start-production', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/publish-now', async (req, res) => {
    start('GET /api/publish-now');
    try {
      const draftId = String(req.query.draftId ?? '').trim();
      if (!draftId) {
        res.status(400).json({ ok: false, error: 'Missing query param: draftId' });
        return;
      }
      const dryRunRaw = String(req.query.dryRun ?? '');
      const dryRun = ['1', 'true', 'yes'].includes(dryRunRaw.toLowerCase());

      const result = await publishDraftToSanity(supabaseClient, config, draftId, {
        generateImage: !dryRun,
        publishAfterCreate: !dryRun,
        updateStatusToPublished: !dryRun,
      });

      success('GET /api/publish-now', { draftId, dryRun, result });
      res.json({ ok: true, draftId, dryRun, ...result });
    } catch (error) {
      fail('GET /api/publish-now', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/social-now', async (_req, res) => {
    start('GET /api/social-now');
    try {
      const dryRunRaw = String(_req.query.dryRun ?? '');
      const dryRun = ['1', 'true', 'yes'].includes(dryRunRaw.toLowerCase());

      const result = await runSocialPosting(supabaseClient, config, { dryRun });
      success('GET /api/social-now', result);
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('GET /api/social-now', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/revise-social', async (req, res) => {
    start('POST /api/revise-social');
    try {
      const { draftId, feedback } = req.body ?? {};
      if (!draftId || !feedback) {
        return res.status(400).json({ ok: false, error: 'Missing draftId or feedback' });
      }

      const revised = await reviseSocialContent(supabaseClient, config, draftId, feedback);

      const slack = createSlackClient(config.SLACK_BOT_TOKEN);
      await sendSocialReviewMessage(slack, config.SLACK_CHANNEL_ID, {
        draftId,
        blogTitle: revised.blogTitle,
        linkedinPost: revised.linkedinPost,
        xPost: revised.xPost,
        xThread: revised.xThread,
      });

      success('POST /api/revise-social', { draftId });
      res.json({ ok: true, draftId, revised });
    } catch (error) {
      fail('POST /api/revise-social', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/orchestrate-now', async (req, res) => {
    start('GET /api/orchestrate-now');
    try {
      const dryRunRaw = String(req.query.dryRun ?? '');
      const dryRun = ['1', 'true', 'yes'].includes(dryRunRaw.toLowerCase());
      const skipSocialRaw = String(req.query.skipSocial ?? '');
      const skipSocial = ['1', 'true', 'yes'].includes(skipSocialRaw.toLowerCase());

      const result = await runOrchestration(supabaseClient, config, { dryRun, skipSocial });
      success('GET /api/orchestrate-now', result);
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('GET /api/orchestrate-now', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/weekly-report', async (_req, res) => {
    start('GET /api/weekly-report');
    try {
      const result = await runWeeklyReport(supabaseClient, config);
      success('GET /api/weekly-report', result);
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('GET /api/weekly-report', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/drafts', async (req, res) => {
    start('GET /api/drafts');
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);

      const { data, error } = await supabaseClient
        .from('content_drafts')
        .select(
          'id, topic_id, blog_title, blog_slug, judge_pass, judge_scores, revision_count, sanity_document_id, linkedin_post_id, x_post_id, published_at, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);

      success('GET /api/drafts', { count: data?.length ?? 0 });
      res.json({ ok: true, drafts: data ?? [] });
    } catch (error) {
      fail('GET /api/drafts', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/drafts/:id', async (req, res) => {
    start('GET /api/drafts/:id');
    try {
      const draftId = String(req.params.id ?? '').trim();
      if (!draftId) {
        return res.status(400).json({ ok: false, error: 'Missing draft id' });
      }

      const { data, error } = await supabaseClient
        .from('content_drafts')
        .select(
          'id, topic_id, blog_title, blog_slug, blog_body, blog_seo_title, blog_seo_description, blog_seo_keywords, blog_category, blog_tags, linkedin_post, x_post, x_thread, judge_pass, judge_scores, judge_flags, revision_count, sanity_document_id, linkedin_post_id, x_post_id, published_at, created_at'
        )
        .eq('id', draftId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return res.status(404).json({ ok: false, error: 'Draft not found' });

      success('GET /api/drafts/:id', { draftId });
      return res.json({ ok: true, draft: data });
    } catch (error) {
      fail('GET /api/drafts/:id', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/drafts/:id/preview', async (req, res) => {
    start('GET /api/drafts/:id/preview');
    try {
      const draftId = String(req.params.id ?? '').trim();
      if (!draftId) {
        return res.status(400).send('Missing draft id');
      }

      let { data, error } = await supabaseClient
        .from('content_drafts')
        .select('id, blog_title, blog_body, image_asset_ref, created_at')
        .eq('id', draftId)
        .maybeSingle();
      if (error && String(error.message || '').includes('image_asset_ref')) {
        ({ data, error } = await supabaseClient
          .from('content_drafts')
          .select('id, blog_title, blog_body, created_at')
          .eq('id', draftId)
          .maybeSingle());
      }

      if (error) throw new Error(error.message);
      if (!data) return res.status(404).send('Draft not found');

      const sections = Array.isArray(data.blog_body) ? data.blog_body : [];
      const renderedSections = sections
        .map((section) => {
          const title = escHtml(section?.title ?? '');
          const body = markdownToHtml(String(section?.body ?? ''));
          return `<section><h2>${title}</h2>${body}</section>`;
        })
        .join('');
      const imageUrl = sanityAssetRefToCdnUrl({
        ref: data.image_asset_ref,
        projectId: config.SANITY_PROJECT_ID,
        dataset: config.SANITY_DATASET,
      });

      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(data.blog_title || 'Draft preview')}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 2rem auto; max-width: 860px; line-height: 1.6; padding: 0 1rem; color: #111; }
      h1 { margin-bottom: 0.5rem; }
      .meta { color: #555; margin-bottom: 2rem; font-size: 0.95rem; }
      section { margin-bottom: 1.5rem; }
      h2 { margin-bottom: 0.4rem; }
      p { margin-top: 0; white-space: normal; }
      ul, ol { padding-left: 1.25rem; }
      img { max-width: 100%; border-radius: 8px; margin: 1rem 0 1.5rem; }
      a { color: #0a5bd8; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <h1>${escHtml(data.blog_title || 'Untitled draft')}</h1>
    <div class="meta">Draft ID: ${escHtml(data.id)}${data.created_at ? ` | Created: ${escHtml(data.created_at)}` : ''}</div>
    ${imageUrl ? `<img src="${escHtml(imageUrl)}" alt="Draft featured image" />` : ''}
    ${renderedSections || '<p><em>No blog sections found.</em></p>'}
  </body>
</html>`;

      success('GET /api/drafts/:id/preview', { draftId });
      return res.status(200).type('html').send(html);
    } catch (error) {
      fail('GET /api/drafts/:id/preview', error);
      return res.status(500).send(`Preview unavailable: ${error.message}`);
    }
  });

  return router;
}

function escHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').replaceAll('\r\n', '\n').split('\n');
  const out = [];
  let inUl = false;
  let inOl = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeLists = () => {
    if (inUl) out.push('</ul>');
    if (inOl) out.push('</ol>');
    inUl = false;
    inOl = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeLists();
      continue;
    }
    if (line.startsWith('### ')) {
      flushParagraph();
      closeLists();
      out.push(`<h4>${inlineMarkdown(line.slice(4))}</h4>`);
      continue;
    }
    if (line.startsWith('## ')) {
      flushParagraph();
      closeLists();
      out.push(`<h3>${inlineMarkdown(line.slice(3))}</h3>`);
      continue;
    }
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (!inUl) {
        closeLists();
        inUl = true;
        out.push('<ul>');
      }
      out.push(`<li>${inlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (!inOl) {
        closeLists();
        inOl = true;
        out.push('<ol>');
      }
      out.push(`<li>${inlineMarkdown(olMatch[1])}</li>`);
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  closeLists();
  return out.join('\n');
}

function inlineMarkdown(text) {
  let html = escHtml(text);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return html;
}

function sanityAssetRefToCdnUrl({ ref, projectId, dataset }) {
  const assetRef = String(ref ?? '').trim();
  if (!assetRef || !projectId || !dataset) return '';
  const match = assetRef.match(/^image-([a-f0-9]+)-(\d+x\d+)-([a-z0-9]+)$/i);
  if (!match) return '';
  const [, hash, dimensions, ext] = match;
  return `https://cdn.sanity.io/images/${projectId}/${dataset}/${hash}-${dimensions}.${ext}`;
}
