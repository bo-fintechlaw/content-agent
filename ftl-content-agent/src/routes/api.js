import express from 'express';
import { runDrafting } from '../pipeline/drafter.js';
import { runJudging } from '../pipeline/judge.js';
import { runDraftAndJudge, recoverTopicReview } from '../pipeline/production.js';
import { runTopicRanking } from '../pipeline/ranker.js';
import { runSourceScan } from '../pipeline/scanner.js';
import { publishDraftToSanity } from '../pipeline/publisher.js';
import { runSocialPosting } from '../pipeline/social-poster.js';
import { reviseSocialContent } from '../pipeline/social-reviser.js';
import { reviseBlogContent } from '../pipeline/blog-reviser.js';
import { runOrchestration } from '../pipeline/orchestrator.js';
import { runWeeklyReport } from '../pipeline/weekly-report.js';
import { importAnalyticsCsv } from '../pipeline/analytics-import.js';
import { clearRankerHintsCache, getRankerPerformanceHints } from '../pipeline/analytics-feedback.js';
import { createSlackClient, sendSocialReviewMessage } from '../integrations/slack.js';
import { createSanityClient, patchPublishedShareImage } from '../integrations/sanity.js';
import axios from 'axios';
import { checkSupabaseConnection } from '../db/supabase.js';
import { fail, start, success } from '../utils/logger.js';
import { createNewsletterTaskRouter } from './newsletter-tasks.js';
import { createSubscribeRouter } from './subscribe.js';

/**
 * API routes — Phase 1: health + stubs. Later: suggest-topic, topics, drafts.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @param {import('@supabase/supabase-js').SupabaseClient | null} [fleetSupabaseClient]
 */
export function createApiRouter(supabaseClient, config, fleetSupabaseClient = null) {
  const router = express.Router();
  const fleetDb = fleetSupabaseClient;

  /** Same gate as start-production / recover-topic (PRODUCTION_TRIGGER_SECRET). */
  function requireProductionTriggerAuth(req, res) {
    const secret = config.PRODUCTION_TRIGGER_SECRET;
    if (!secret) return true;
    const token = String(
      req.query.token ?? req.headers['x-content-agent-token'] ?? '',
    ).trim();
    if (token !== secret) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return false;
    }
    return true;
  }

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

  // Cron run history. Lets you answer "did the 7am cron fire today?" without
  // pulling Railway logs. Returns the most recent N runs grouped by cron name.
  router.get('/cron-health', async (req, res) => {
    start('GET /api/cron-health');
    try {
      const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
      const { data, error } = await supabaseClient
        .from('cron_runs')
        .select('id, cron_name, status, started_at, finished_at, duration_ms, error_message, summary')
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);

      const grouped = {};
      for (const row of data ?? []) {
        const arr = grouped[row.cron_name] ?? (grouped[row.cron_name] = []);
        arr.push(row);
      }
      const lastByName = {};
      for (const [name, runs] of Object.entries(grouped)) {
        const lastSuccess = runs.find((r) => r.status === 'success');
        const lastFailure = runs.find((r) => r.status === 'failed');
        lastByName[name] = {
          totalReturned: runs.length,
          lastRun: runs[0] ?? null,
          lastSuccess: lastSuccess ?? null,
          lastFailure: lastFailure ?? null,
        };
      }

      success('GET /api/cron-health', { limit, names: Object.keys(grouped) });
      res.status(200).json({ summary: lastByName, runs: data ?? [] });
    } catch (error) {
      fail('GET /api/cron-health', error);
      res.status(500).json({ error: error.message });
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
      const stats = await runSourceScan(supabaseClient, { config });
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

  /** Recover a prejudge-blocked draft and judge → Slack (no new draft). */
  router.get('/recover-topic', async (req, res) => {
    start('GET /api/recover-topic');
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
      const draftId = String(req.query.draftId ?? '').trim();
      if (!topicId && !draftId) {
        res.status(400).json({ ok: false, error: 'Missing query param: topicId or draftId' });
        return;
      }
      const result = await recoverTopicReview(supabaseClient, config, {
        topicId: topicId || undefined,
        draftId: draftId || undefined,
      });
      success('GET /api/recover-topic', { topicId: topicId || null, draftId: draftId || null });
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('GET /api/recover-topic', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/publish-now', async (req, res) => {
    start('GET /api/publish-now');
    try {
      if (!requireProductionTriggerAuth(req, res)) return;
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

  // Backfill a featured image on an already-published Sanity doc. Use when the
  // initial publish ran without XAI_API_KEY, or when image generation failed
  // transiently (xAI hiccup, circuit breaker open, etc). Re-runs Grok Imagine
  // with the draft's stored image_prompt and patches shareImage on the
  // published doc, then pings the Netlify rebuild hook so the live page picks
  // up the asset.
  router.get('/regenerate-image', async (req, res) => {
    start('GET /api/regenerate-image');
    try {
      if (!requireProductionTriggerAuth(req, res)) return;
      const draftId = String(req.query.draftId ?? '').trim();
      if (!draftId) {
        res.status(400).json({ ok: false, error: 'Missing query param: draftId' });
        return;
      }
      const { data: draft, error } = await supabaseClient
        .from('content_drafts')
        .select('id, sanity_document_id, image_prompt, blog_slug, blog_title')
        .eq('id', draftId)
        .single();
      if (error) throw new Error(error.message);
      if (!draft?.sanity_document_id) {
        res.status(400).json({
          ok: false,
          error: 'Draft has no sanity_document_id — has it been published?',
        });
        return;
      }
      if (!draft.image_prompt?.trim()) {
        res.status(400).json({ ok: false, error: 'Draft has no image_prompt' });
        return;
      }

      const sanityClient = createSanityClient(config);
      const result = await patchPublishedShareImage(sanityClient, config, {
        publishedId: draft.sanity_document_id,
        imagePrompt: draft.image_prompt,
        blogSlug: draft.blog_slug || 'blog',
      });

      // Wait 10s before pinging Netlify so apicdn.sanity.io has propagated
      // the patch we just committed; otherwise the build queries Sanity
      // through the CDN and gets pre-patch state.
      // See: feedback_sanity_cdn_race
      let netlifyTriggered = false;
      if (config.NETLIFY_BUILD_HOOK) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          await axios.post(config.NETLIFY_BUILD_HOOK);
          netlifyTriggered = true;
        } catch (netlifyErr) {
          fail('GET /api/regenerate-image:netlifyRebuild', netlifyErr);
        }
      }

      success('GET /api/regenerate-image', {
        draftId,
        publishedId: result.publishedId,
        netlifyTriggered,
      });
      res.json({ ok: true, draftId, ...result, netlifyTriggered });
    } catch (error) {
      fail('GET /api/regenerate-image', error);
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

  // Trigger a targeted blog revision outside the Slack modal flow. Mirrors the
  // Slack "Request Changes" path: reviseBlogContent edits only the sections the
  // feedback addresses, then runJudging re-evaluates and sends a fresh review
  // message to Slack. Useful for replaying corrections after a deploy or for
  // scripted/automated revisions.
  router.post('/revise-blog', async (req, res) => {
    start('POST /api/revise-blog');
    try {
      const { draftId, feedback } = req.body ?? {};
      if (!draftId || !feedback) {
        return res.status(400).json({ ok: false, error: 'Missing draftId or feedback' });
      }

      const revised = await reviseBlogContent(supabaseClient, config, draftId, feedback);
      const judged = await runJudging(supabaseClient, config, { draftId });

      success('POST /api/revise-blog', { draftId, judged: judged?.judged });
      res.json({ ok: true, draftId, revised, judge: judged });
    } catch (error) {
      fail('POST /api/revise-blog', error);
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
      if (!requireProductionTriggerAuth(req, res)) return;
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

  // CSV-based analytics import. Two ways to call:
  //   1. POST text/csv body with ?kind=...&periodStart=...&periodEnd=...
  //   2. POST JSON { kind, csvText, periodStart, periodEnd }
  // Accepts up to ~5MB of CSV. JSON bodies are handled by app-level express.json();
  // this route adds an express.text() layer so text/csv arrives as a raw string.
  router.post('/analytics/import', express.text({
    type: ['text/csv', 'text/plain', 'application/octet-stream'],
    limit: '5mb',
  }), async (req, res) => {
    start('POST /api/analytics/import');
    try {
      let kind, csvText, periodStart, periodEnd;
      const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
      if (contentType.includes('application/json') && req.body && typeof req.body === 'object') {
        ({ kind, csvText, periodStart, periodEnd } = req.body);
      } else {
        kind = String(req.query.kind ?? '').trim();
        periodStart = String(req.query.periodStart ?? '').trim() || null;
        periodEnd = String(req.query.periodEnd ?? '').trim() || null;
        csvText = typeof req.body === 'string' ? req.body : '';
      }
      if (!kind) return res.status(400).json({ ok: false, error: 'Missing kind' });
      if (!csvText) return res.status(400).json({ ok: false, error: 'Missing csvText body' });

      const result = await importAnalyticsCsv(supabaseClient, {
        kind,
        csvText,
        periodStart,
        periodEnd,
      });
      // Fresh import invalidates any cached ranker hints.
      clearRankerHintsCache();
      success('POST /api/analytics/import', result);
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('POST /api/analytics/import', error);
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // Inspect what the ranker will see on its next run. Useful after an import
  // to confirm the hints look right before the next ranker tick fires.
  router.get('/analytics/hints', async (_req, res) => {
    start('GET /api/analytics/hints');
    try {
      const hints = await getRankerPerformanceHints(supabaseClient, { force: true });
      success('GET /api/analytics/hints');
      res.json({ ok: true, hints });
    } catch (error) {
      fail('GET /api/analytics/hints', error);
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
    <title>${escHtml(data.blog_title || 'Draft preview')}</title>
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

  if (fleetDb) {
    router.use('/', createNewsletterTaskRouter(fleetDb, config));
    router.use('/', createSubscribeRouter(fleetDb, config));
  }

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
