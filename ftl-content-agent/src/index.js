import dotenv from 'dotenv';
import express from 'express';
import cron from 'node-cron';
import { validateEnv } from './config/env.js';
import { initializeMcpConnections } from '../dist/mcp/mcpManager.js';
import { createSupabaseClient, createFleetSupabaseClient } from './db/supabase.js';
import { createApiRouter } from './routes/api.js';
import { createSlackWebhookRouter } from './routes/webhooks.js';
import { runSourceScan } from './pipeline/scanner.js';
import { runTopicRanking } from './pipeline/ranker.js';
import { runDrafting } from './pipeline/drafter.js';
import { runJudging } from './pipeline/judge.js';
import { runOrchestration } from './pipeline/orchestrator.js';
import { runWeeklyReport } from './pipeline/weekly-report.js';
import { tpmBudget } from './utils/tpm-budget.js';
import { registerLinkedInOAuthDevCallback } from './routes/linkedin-oauth.js';
import {
  createSlackClient,
  sendDailyNoDraftNotification,
  sendFeedHealthReport,
  sendMondaySearchAndRankReport,
} from './integrations/slack.js';
import { runFeedHealthCheck } from './utils/feed-health.js';
import { fail, start, success } from './utils/logger.js';
import { withCronRun } from './utils/cron-runs.js';
import axios from 'axios';

// Prefer project .env over inherited shell vars.
dotenv.config({ override: true });

async function main() {
  start('main');

  const config = validateEnv();

  // Wire per-model TPM caps from validated env so anthropic.js calls
  // throttle below Anthropic's per-tier ceilings before we hit a 429.
  tpmBudget.setLimit(config.ANTHROPIC_MODEL, config.ANTHROPIC_TPM_LIMIT);
  tpmBudget.setLimit(
    config.ANTHROPIC_SUBAGENT_MODEL,
    config.ANTHROPIC_SUBAGENT_TPM_LIMIT
  );

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
  const fleetSupabaseClient = createFleetSupabaseClient(config);
  if (!fleetSupabaseClient) {
    console.warn(
      '[ftl-content-agent] SUPABASE_FLEET_URL / SUPABASE_FLEET_SERVICE_KEY not set — newsletter routes disabled'
    );
  }

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

  app.use('/api', createApiRouter(supabaseClient, config, fleetSupabaseClient));

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
          // Feed-health report: runs after scan+rank so the user knows which
          // sources are pulling cleanly. Best-effort — a Slack failure here
          // shouldn't poison the cron's outcome record.
          try {
            const health = await runFeedHealthCheck();
            const slack = createSlackClient(config.SLACK_BOT_TOKEN);
            await sendFeedHealthReport(slack, config.SLACK_CHANNEL_ID, health);
          } catch (healthErr) {
            fail('cron:weeklyScanAndRank:feedHealth', healthErr);
          }
          return { scan, rank };
        });
      } catch (e) {
        fail('cron:weeklyScanAndRank', e);
      }
    },
    { timezone: 'America/New_York' }
  );

  // ── Daily drafter — 7 AM ET ───────────────────────────────────
  // Picks the draft queue (revision first, else best ranked) and creates the
  // draft only. Judging is decoupled into its own cron below so the two
  // stages don't compete for the same per-minute Anthropic TPM bucket.
  // For on-demand draft+judge in a single tick, use GET /api/start-production?topicId=...
  cron.schedule(
    '0 7 * * *',
    async () => {
      start('cron:dailyDrafter');
      try {
        await withCronRun(supabaseClient, 'cron:dailyDrafter', async () => {
          const result = await runDrafting(supabaseClient, config, {
            minRelevanceScore: config.DAILY_PUBLISH_MIN_RELEVANCE,
          });
          success('cron:dailyDrafter', result);
          if (!result.drafted) {
            try {
              const slack = createSlackClient(config.SLACK_BOT_TOKEN);
              await sendDailyNoDraftNotification(
                slack,
                config.SLACK_CHANNEL_ID,
                result
              );
            } catch (slackErr) {
              fail('cron:dailyDrafter:slack', slackErr);
            }
          }
          return {
            drafted: result.drafted ?? false,
            draftId: result.draftId ?? null,
            topicId: result.topicId ?? null,
            reason: result.reason ?? null,
          };
        });
      } catch (e) {
        fail('cron:dailyDrafter', e);
      }
    },
    { timezone: 'America/New_York' }
  );

  // ── Judge tick — every 5 min ──────────────────────────────────
  // Single entry point for both first-judge and retry of deferred drafts.
  // Picks the oldest unjudged draft created at least 5 min ago (so the
  // drafter's TPM burst has cleared the per-minute window before we add the
  // judge's load) and that hasn't blown the defer cap. Single-flight guard
  // mirrors orchestration so a slow tick can't overlap the next.
  let judgeTickRunning = false;
  cron.schedule(
    '*/5 * * * *',
    async () => {
      if (judgeTickRunning) return;
      judgeTickRunning = true;
      start('cron:judge');
      try {
        await withCronRun(supabaseClient, 'cron:judge', async () => {
          // Filter at the SQL boundary so we never even look at drafts
          // created seconds ago — they need to age out of the same TPM
          // window the drafter just consumed.
          const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
          const { data: candidates, error: qErr } = await supabaseClient
            .from('content_drafts')
            .select('id, judge_flags, created_at')
            .is('judge_pass', null)
            .lt('created_at', fiveMinAgo)
            .order('created_at', { ascending: true })
            .limit(10);
          if (qErr) throw new Error(qErr.message);
          const MAX_DEFERS = 4;
          const next = (candidates ?? []).find((d) => {
            const flags = Array.isArray(d.judge_flags) ? d.judge_flags : [];
            const defers = flags.filter(
              (f) => typeof f === 'string' && f.startsWith('defer:')
            );
            return defers.length < MAX_DEFERS;
          });
          if (!next) {
            success('cron:judge', { reason: 'no_judgeable_drafts' });
            return { judged: false, reason: 'no_judgeable_drafts' };
          }
          const result = await runJudging(supabaseClient, config, { draftId: next.id });
          success('cron:judge', {
            draftId: next.id,
            judged: result.judged ?? false,
            deferred: result.deferred ?? false,
          });
          return result;
        });
      } catch (e) {
        fail('cron:judge', e);
      } finally {
        judgeTickRunning = false;
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

  // Newsletter — Thursday 7:30 AM ET: trigger CMO assemble (review in Slack, not Friday PM)
  if (config.ENABLE_NEWSLETTER && config.CMO_ASSEMBLE_URL) {
    cron.schedule(
      '30 7 * * 4',
      async () => {
        start('cron:newsletterAssemble');
        try {
          await withCronRun(supabaseClient, 'cron:newsletterAssemble', async () => {
            const res = await axios.post(config.CMO_ASSEMBLE_URL, {}, { timeout: 120_000 });
            success('cron:newsletterAssemble', { status: res.status });
            return { status: res.status, data: res.data };
          });
        } catch (e) {
          fail('cron:newsletterAssemble', e);
        }
      },
      { timezone: 'America/New_York' }
    );
  }

  server.on('error', (err) => {
    fail('main', err);
    process.exit(1);
  });
}

main().catch((err) => {
  fail('main', err);
  process.exit(1);
});
