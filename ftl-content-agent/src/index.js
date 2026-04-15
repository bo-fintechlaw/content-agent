import dotenv from 'dotenv';
import express from 'express';
import cron from 'node-cron';
import { validateEnv } from './config/env.js';
import { initializeMcpConnections } from '../dist/mcp/mcpManager.js';
import { createSupabaseClient } from './db/supabase.js';
import { createApiRouter } from './routes/api.js';
import { createSlackWebhookRouter } from './routes/webhooks.js';
import { runSourceScan } from './pipeline/scanner.js';
import { runOrchestration } from './pipeline/orchestrator.js';
import { registerLinkedInOAuthDevCallback } from './routes/linkedin-oauth.js';
import { fail, start, success } from './utils/logger.js';

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

  cron.schedule(
    '0 6 * * *',
    async () => {
      start('cron:dailySourceScan');
      try {
        await runSourceScan(supabaseClient);
        success('cron:dailySourceScan');
      } catch (e) {
        fail('cron:dailySourceScan', e);
      }
    },
    { timezone: 'America/New_York' }
  );

  let orchestrationRunning = false;
  cron.schedule(
    '*/15 * * * *',
    async () => {
      if (orchestrationRunning) return;
      orchestrationRunning = true;
      start('cron:orchestration');
      try {
        await runOrchestration(supabaseClient, config);
        success('cron:orchestration');
      } catch (e) {
        fail('cron:orchestration', e);
      } finally {
        orchestrationRunning = false;
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
