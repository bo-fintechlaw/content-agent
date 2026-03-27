import express from 'express';
import { runDrafting } from '../pipeline/drafter.js';
import { runJudging } from '../pipeline/judge.js';
import { runTopicRanking } from '../pipeline/ranker.js';
import { runSourceScan } from '../pipeline/scanner.js';
import { publishDraftToSanity } from '../pipeline/publisher.js';
import { runSocialPosting } from '../pipeline/social-poster.js';
import { runOrchestration } from '../pipeline/orchestrator.js';
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

  router.post('/suggest-topic', async (_req, res) => {
    start('POST /api/suggest-topic');
    success('POST /api/suggest-topic', { stub: true });
    res.status(501).json({
      ok: false,
      message: 'Not implemented — manual suggestions in a later phase',
    });
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

  router.get('/judge-now', async (_req, res) => {
    start('GET /api/judge-now');
    try {
      const result = await runJudging(supabaseClient, config);
      success('GET /api/judge-now', result);
      res.json({ ok: true, ...result });
    } catch (error) {
      fail('GET /api/judge-now', error);
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

  router.get('/drafts', async (_req, res) => {
    start('GET /api/drafts');
    success('GET /api/drafts', { stub: true });
    res.status(501).json({
      ok: false,
      message: 'Not implemented — Phase 2+',
    });
  });

  return router;
}
