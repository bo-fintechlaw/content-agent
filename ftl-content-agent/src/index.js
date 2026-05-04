import dotenv from 'dotenv';
import express from 'express';
import cron from 'node-cron';
import { validateEnv } from './config/env.js';
import { initializeMcpConnections } from '../dist/mcp/mcpManager.js';
import { createSupabaseClient } from './db/supabase.js';
import { createApiRouter } from './routes/api.js';
import { createSlackWebhookRouter } from './routes/webhooks.js';
import { runSourceScan } from './pipeline/scanner.js';
import { runTopicRanking } from './pipeline/ranker.js';
import { runDraftAndJudge } from './pipeline/production.js';
import { runOrchestration } from './pipeline/orchestrator.js';
import { runWeeklyReport } from './pipeline/weekly-report.js';
import { registerLinkedInOAuthDevCallback } from './routes/linkedin-oauth.js';
import {
  createSlackClient,
  sendDailyNoDraftNotification,
  sendMondaySearchAndRankReport,
} from './integrations/slack.js';
import { fail, start, success } from './utils/logger.js';
import { withCronRun } from './utils/cron-runs.js';

// Prefer project .env over inherited shell vars.
dotenv.config({ override: true });

async function main() {
  start('main');

  const config = validateEnv();

  void initializeMcpConnections({
    NOTION_MCP_URL: config.NOTION_MCP_URL,
    NOTION_MCP_AUTH_TOKEN: config.NOTION_MCP_AUTH_TOKEN,
    SANITY_MCP_URL: config.SANITY_MCP_URL,
    SANITY_API_TOKEN: config.SANITY_API_TOKEN,
  }).catch((err) => {
    console.warn('[MCP] Notion MCP initialization error:', err);
  });

  if (config.LINKEDIN_REDIRECT_URI?.startsWith('https://localhost')) {
    console.warn(
      '[ftl-content-agent] LINKEDIN_REDIRECT_URI uses https://localhost but this app serves HTTP only. ' +
        'Use http://localhost:3001/callback/linkedin in .env and in the LinkedIn app redirect URLs, or add TLS.'
    );
  }

  const supabaseClient = createSupabaseClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_KEY
  );

  const app = express();
  app.locals.cron = cron;
  app.use(express.json());

  registerLinkedInOAuthDevCallback(app, config);
  app.use('/slack', createSlackWebhookRouter(supabaseClient, config));

  app.get('/health', (_req, res) => {
    start('GET /health');
    const timestamp = new Date().toISOString();
    success('GET /health');
    res.status(200).json({ status: 'ok', timestamp });
  });

  app.use('/api', createApiRouter(supabaseClient, config));

  const server = app.listen(config.PORT, () => {
    success('main', {
      message: `Listening on port ${config.PORT}`,
      env: config.NODE_ENV,
    });
  });

  // ── Weekly scan + rank — Monday 6 AM ET ────────────────────────
  // Pulls a full week of RSS content, then ranks the entire batch.
  cron.schedule(
    '0 6 * * 1',
    async () => {
      start('cron:weeklyScanAndRank');
      try {
        await withCronRun(supabaseClient, 'cron:weeklyScanAndRank', async () => {
          const scan = await runSourceScan(supabaseClient);
          success('cron:weeklyScanAndRank:scan', scan);
          const rank = await runTopicRanking(supabaseClient, config);
          success('cron:weeklyScanAndRank:rank', rank);
          try {
            const slack = createSlackClient(config.SLACK_BOT_TOKEN);
            await sendMondaySearchAndRankReport(slack, config.SLACK_CHANNEL_ID, {
              scan,
              rank,
            });
          } catch (slackErr) {
            fail('cron:weeklyScanAndRank:slack', slackErr);
          }
          return { scan, rank };
        });
      } catch (e) {
        fail('cron:weeklyScanAndRank', e);
      }
    },
    { timezone: 'America/New_York' }
  );

  // ── Daily content — 7 AM ET ───────────────────────────────────
  // Picks the draft queue (revision first, else best ranked). Ranked rows must meet
  // DAILY_PUBLISH_MIN_RELEVANCE (default 7). Then judges → Slack for approval (no auto-publish
  // unless AUTO_PUBLISH_ON_REVIEW is set). For an extra post any time, use GET
  // /api/start-production?topicId=...
  cron.schedule(
    '0 7 * * *',
    async () => {
      start('cron:dailyContent');
      try {
        await withCronRun(supabaseClient, 'cron:dailyContent', async () => {
          const result = await runDraftAndJudge(supabaseClient, config, {
            minRelevanceScore: config.DAILY_PUBLISH_MIN_RELEVANCE,
            runKind: 'scheduled',
          });
          success('cron:dailyContent', result);
          if (result.draft && !result.draft.drafted) {
            try {
              const slack = createSlackClient(config.SLACK_BOT_TOKEN);
              await sendDailyNoDraftNotification(
                slack,
                config.SLACK_CHANNEL_ID,
                result.draft
              );
            } catch (slackErr) {
              fail('cron:dailyContent:slack', slackErr);
            }
          }
          return {
            runKind: result.runKind,
            drafted: result.draft?.drafted ?? false,
            draftId: result.draft?.draftId ?? null,
            judged: result.judge?.judged ?? false,
            verdict: result.judge?.verdict ?? null,
            deferred: result.judge?.deferred ?? false,
          };
        });
      } catch (e) {
        fail('cron:dailyContent', e);
      }
    },
    { timezone: 'America/New_York' }
  );

  // ── Orchestrator — every 15 min ───────────────────────────────
  // Lightweight: only publishes approved drafts + posts to social.
  // No ranking/drafting/judging — those run on their own schedules.
  let orchestrationRunning = false;
  cron.schedule(
    '*/15 * * * *',
    async () => {
      if (orchestrationRunning) return;
      orchestrationRunning = true;
      start('cron:orchestration');
      try {
        await withCronRun(supabaseClient, 'cron:orchestration', async () => {
          const r = await runOrchestration(supabaseClient, config);
          success('cron:orchestration');
          return r;
        });
      } catch (e) {
        fail('cron:orchestration', e);
      } finally {
        orchestrationRunning = false;
      }
    },
    { timezone: 'America/New_York' }
  );

  // Weekly content report — Monday 9 AM ET
  cron.schedule(
    '0 9 * * 1',
    async () => {
      start('cron:weeklyReport');
      try {
        await withCronRun(supabaseClient, 'cron:weeklyReport', async () => {
          const r = await runWeeklyReport(supabaseClient, config);
          success('cron:weeklyReport');
          return r;
        });
      } catch (e) {
        fail('cron:weeklyReport', e);
      }
    },
    { timezone: 'America/New_York' }
  );

  server.on('error', (err) => {
    fail('main', err);
    process.exit(1);
  });
}

main().catch((err) => {
  fail('main', err);
  process.exit(1);
});
