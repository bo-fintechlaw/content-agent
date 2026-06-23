import { fail, start, success } from '../utils/logger.js';

/** xAI api.x.ai key for Grok Imagine (not Twitter’s X_API_KEY). Used by one-off scripts without full validateEnv. */
export function xaiKeyFromProcessEnv() {
  return (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
}

// Slack review messages embed a "Full draft" preview link built from this base.
// Prefer an explicit APP_BASE_URL; fall back to Railway's RAILWAY_PUBLIC_DOMAIN
// (set automatically on any service with a public domain) so the link survives
// env drift on Railway without a manual env-var fix.
function resolveAppBaseUrl(explicit) {
  const fromExplicit = String(explicit ?? '').trim();
  if (fromExplicit) return fromExplicit;
  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN ?? '').trim();
  if (!railwayDomain) return '';
  const stripped = railwayDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${stripped}`;
}

/** Must be present and non-empty (trimmed). */
const REQUIRED_NON_EMPTY = [
  'ANTHROPIC_API_KEY',
  'SANITY_PROJECT_ID',
  'SANITY_DATASET',
  'SANITY_API_TOKEN',
  'SANITY_SCHEMA_ID',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'SLACK_CHANNEL_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
];

/** May be unset until you finish OAuth / later phases — default to empty string in config. */
const OPTIONAL_STRING = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SUBAGENT_MODEL',
  'ANTHROPIC_TPM_LIMIT',
  'ANTHROPIC_SUBAGENT_TPM_LIMIT',
  'LINKEDIN_ACCESS_TOKEN',
  'LINKEDIN_PERSON_URN',
  'LINKEDIN_REDIRECT_URI',
  'X_API_KEY',
  'X_API_SECRET',
  'X_ACCESS_TOKEN',
  'X_ACCESS_TOKEN_SECRET',
  'X_BEARER_TOKEN',
  'X_CLIENT_ID',
  'X_CLIENT_SECRET',
  'ENABLE_X_POSTING',
  'AUTO_PUBLISH_ON_REVIEW',
  'JUDGE_FALLBACK_PASS_ON_ANTHROPIC_UNAVAILABLE',
  'DRAFTER_FALLBACK_SIMPLE_ON_ANTHROPIC_UNAVAILABLE',
  'NETLIFY_BUILD_HOOK',
  'XAI_API_KEY',
  'GROK_API_KEY',
  'DAILY_PUBLISH_MIN_RELEVANCE',
  'DAILY_PUBLISH_BACKFILL_TARGET',
  'RANK_BATCH_LIMIT',
  'SCAN_WINDOW_HOURS',
  'SCAN_ITEMS_PER_FEED',
  'ENABLE_RIKKA_PIPELINE',
  'RIKKA_PUBLISH_MODE',
  'PRODUCTION_TRIGGER_SECRET',
  'PREJUDGE_ENFORCE_VERIFIED_CITATIONS',
  'NOTION_MCP_URL',
  'NOTION_MCP_AUTH_TOKEN',
  'SANITY_MCP_URL',
  'NOTION_TOKEN',
  'NOTION_DB_CONTENT_CALENDAR',
  'NOTION_DB_REGULATORY_TRACKER',
  'NOTION_DB_ACTIVITY_LOG',
  'APP_BASE_URL',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'RESEND_FROM_EMAIL',
  'RESEND_AUDIENCE_ID',
  'RESEND_AUDIENCE_FINANCIAL_SERVICES',
  'RESEND_AUDIENCE_TECH_AI_LEGAL',
  'RESEND_WEBHOOK_SECRET',
  'NEWSLETTER_TOKEN_SECRET',
  'NEWSLETTER_SITE_URL',
  'NEWSLETTER_TEST_EMAIL',
  'NEWSLETTER_TASK_SECRET',
  'FINTECHLAW_LOGO_URL',
  'SLACK_CMO_SIGNING_SECRET',
  'SLACK_CMO_BO_CHANNEL_ID',
  'ENABLE_NEWSLETTER',
  'CMO_ASSEMBLE_URL',
  'SUPABASE_FLEET_URL',
  'SUPABASE_FLEET_SERVICE_KEY',
];

/**
 * Validates required environment variables (fail-fast). Throws if any are missing or PORT is invalid.
 * @returns {Record<string, string | number>}
 */
export function validateEnv() {
  start('validateEnv');

  const missing = [];
  for (const key of REQUIRED_NON_EMPTY) {
    const value = process.env[key];
    if (value === undefined || String(value).trim() === '') {
      missing.push(key);
    }
  }

  const slackBotToken =
    process.env.SLACK_BOT_TOKEN?.trim() ||
    process.env.BOT_USER_OAUTH_TOKEN?.trim();
  if (!slackBotToken) {
    missing.push('SLACK_BOT_TOKEN (or BOT_USER_OAUTH_TOKEN)');
  }

  const portRaw = process.env.PORT ?? '3001';
  const port = Number.parseInt(portRaw, 10);
  if (Number.isNaN(port) || port < 1) {
    const err = new Error(`Invalid PORT: ${portRaw}`);
    fail('validateEnv', err);
    throw err;
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (missing.length > 0) {
    const err = new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
    fail('validateEnv', err, { missing });
    throw err;
  }

  const optional = Object.fromEntries(
    OPTIONAL_STRING.map((k) => [k, process.env[k] ?? ''])
  );

  const notionMcpUrl =
    optional.NOTION_MCP_URL?.trim() || 'http://127.0.0.1:3100/mcp';

  // Subagent (citation + claim verification) defaults to Haiku so it draws
  // from a separate per-model rate-limit bucket from the main drafter/judge
  // running on Opus. Override with ANTHROPIC_SUBAGENT_MODEL if needed.
  const tpmLimitRaw = (optional.ANTHROPIC_TPM_LIMIT ?? '').trim();
  const tpmLimit = Number.parseInt(tpmLimitRaw, 10);
  const subagentTpmLimitRaw = (optional.ANTHROPIC_SUBAGENT_TPM_LIMIT ?? '').trim();
  const subagentTpmLimit = Number.parseInt(subagentTpmLimitRaw, 10);

  const config = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: optional.ANTHROPIC_MODEL || 'claude-opus-4-8', // pragma: allowlist secret // pragma: allowlist secret
    ANTHROPIC_SUBAGENT_MODEL:
      optional.ANTHROPIC_SUBAGENT_MODEL || 'claude-haiku-4-5-20251001',
    // Tier-1 input-token-per-minute caps (Opus ~30k, Haiku ~50k as of 2026-Q2).
    // We hold below the hard ceiling so the in-process budget guard sleeps
    // before Anthropic 429s us. Override per env if the account tier changes.
    ANTHROPIC_TPM_LIMIT: Number.isFinite(tpmLimit) && tpmLimit > 0 ? tpmLimit : 25_000,
    ANTHROPIC_SUBAGENT_TPM_LIMIT:
      Number.isFinite(subagentTpmLimit) && subagentTpmLimit > 0 ? subagentTpmLimit : 40_000,
    SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
    SANITY_DATASET: process.env.SANITY_DATASET,
    SANITY_API_TOKEN: process.env.SANITY_API_TOKEN,
    SANITY_MCP_URL:
      optional.SANITY_MCP_URL?.trim() || 'https://mcp.sanity.io',
    SANITY_SCHEMA_ID: process.env.SANITY_SCHEMA_ID,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
    LINKEDIN_ACCESS_TOKEN: optional.LINKEDIN_ACCESS_TOKEN,
    LINKEDIN_PERSON_URN: optional.LINKEDIN_PERSON_URN,
    LINKEDIN_REDIRECT_URI:
      optional.LINKEDIN_REDIRECT_URI ||
      `http://localhost:${port}/callback/linkedin`,
    X_API_KEY: optional.X_API_KEY,
    X_API_SECRET: optional.X_API_SECRET,
    X_ACCESS_TOKEN: optional.X_ACCESS_TOKEN,
    X_ACCESS_TOKEN_SECRET: optional.X_ACCESS_TOKEN_SECRET,
    X_BEARER_TOKEN: optional.X_BEARER_TOKEN,
    X_CLIENT_ID: optional.X_CLIENT_ID,
    X_CLIENT_SECRET: optional.X_CLIENT_SECRET,
    SLACK_BOT_TOKEN: slackBotToken,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    SLACK_CMO_SIGNING_SECRET: (optional.SLACK_CMO_SIGNING_SECRET ?? '').trim(),
    SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    NOTION_MCP_URL: notionMcpUrl,
    NOTION_MCP_AUTH_TOKEN: optional.NOTION_MCP_AUTH_TOKEN?.trim() ?? '',
    NOTION_TOKEN: optional.NOTION_TOKEN?.trim() ?? '',
    NOTION_DB_CONTENT_CALENDAR: optional.NOTION_DB_CONTENT_CALENDAR?.trim() ?? '',
    NOTION_DB_REGULATORY_TRACKER:
      optional.NOTION_DB_REGULATORY_TRACKER?.trim() ?? '',
    NOTION_DB_ACTIVITY_LOG: optional.NOTION_DB_ACTIVITY_LOG?.trim() ?? '',
    APP_BASE_URL: resolveAppBaseUrl(optional.APP_BASE_URL),
    PORT: port,
    NODE_ENV: nodeEnv,
  };

  // Optional behavior flags for orchestration/testing.
  const autoPublishOnReviewRaw = optional.AUTO_PUBLISH_ON_REVIEW;
  const autoPublishOnReview =
    autoPublishOnReviewRaw === ''
      ? false
      : ['1', 'true', 'yes', 'y'].includes(String(autoPublishOnReviewRaw).toLowerCase());

  config.AUTO_PUBLISH_ON_REVIEW = autoPublishOnReview;

  const judgeFallbackRaw = optional.JUDGE_FALLBACK_PASS_ON_ANTHROPIC_UNAVAILABLE;
  const judgeFallback =
    judgeFallbackRaw === ''
      ? true
      : ['1', 'true', 'yes', 'y'].includes(String(judgeFallbackRaw).toLowerCase());
  config.JUDGE_FALLBACK_PASS_ON_ANTHROPIC_UNAVAILABLE = judgeFallback;

  const drafterFallbackRaw =
    optional.DRAFTER_FALLBACK_SIMPLE_ON_ANTHROPIC_UNAVAILABLE;
  const drafterFallback =
    drafterFallbackRaw === ''
      ? true
      : ['1', 'true', 'yes', 'y'].includes(String(drafterFallbackRaw).toLowerCase());
  config.DRAFTER_FALLBACK_SIMPLE_ON_ANTHROPIC_UNAVAILABLE = drafterFallback;

  config.NETLIFY_BUILD_HOOK = optional.NETLIFY_BUILD_HOOK || '';
  // xAI Grok (api.x.ai) for blog image generation. NOT the same as X (Twitter) X_API_KEY.
  // Prefer XAI_API_KEY; GROK_API_KEY is an allowed alias in .env.
  const xaiPrimary = (optional.XAI_API_KEY || '').trim();
  const xaiGrok = (optional.GROK_API_KEY || '').trim();
  config.XAI_API_KEY = xaiPrimary || xaiGrok || '';

  const orchestrationMaxPublishRaw = process.env.ORCHESTRATION_MAX_PUBLISH ?? '2';
  const orchestrationMaxPublish = Number.parseInt(orchestrationMaxPublishRaw, 10);
  config.ORCHESTRATION_MAX_PUBLISH = Number.isNaN(orchestrationMaxPublish)
    ? 2
    : Math.max(1, orchestrationMaxPublish);

  const orchestrationMaxSocialRaw = process.env.ORCHESTRATION_MAX_SOCIAL ?? '3';
  const orchestrationMaxSocial = Number.parseInt(orchestrationMaxSocialRaw, 10);
  config.ORCHESTRATION_MAX_SOCIAL = Number.isNaN(orchestrationMaxSocial)
    ? 3
    : Math.max(1, orchestrationMaxSocial);

  const dailyMinRaw = (optional.DAILY_PUBLISH_MIN_RELEVANCE ?? '7').trim() || '7';
  const dailyMin = Number.parseFloat(dailyMinRaw);
  config.DAILY_PUBLISH_MIN_RELEVANCE = Number.isNaN(dailyMin) ? 7.0 : dailyMin;

  const backfillTargetRaw =
    (optional.DAILY_PUBLISH_BACKFILL_TARGET ?? '5').trim() || '5';
  const backfillTarget = Number.parseFloat(backfillTargetRaw);
  config.DAILY_PUBLISH_BACKFILL_TARGET = Number.isNaN(backfillTarget)
    ? 5
    : backfillTarget;

  const rankBatchRaw = (optional.RANK_BATCH_LIMIT ?? '75').trim() || '75';
  const rankBatch = Number.parseInt(rankBatchRaw, 10);
  config.RANK_BATCH_LIMIT = Number.isNaN(rankBatch) ? 75 : Math.max(1, rankBatch);

  config.SCAN_WINDOW_HOURS = (optional.SCAN_WINDOW_HOURS ?? '168').trim() || '168';
  config.SCAN_ITEMS_PER_FEED = (optional.SCAN_ITEMS_PER_FEED ?? '35').trim() || '35';

  const enableRikkaRaw = optional.ENABLE_RIKKA_PIPELINE;
  config.ENABLE_RIKKA_PIPELINE =
    enableRikkaRaw === ''
      ? false
      : ['1', 'true', 'yes', 'y'].includes(String(enableRikkaRaw).toLowerCase());
  config.RIKKA_PUBLISH_MODE = (optional.RIKKA_PUBLISH_MODE ?? 'ftl_test').trim() || 'ftl_test';

  config.PRODUCTION_TRIGGER_SECRET = (optional.PRODUCTION_TRIGGER_SECRET ?? '').trim();
  const prejudgeCitationsRaw = optional.PREJUDGE_ENFORCE_VERIFIED_CITATIONS;
  config.PREJUDGE_ENFORCE_VERIFIED_CITATIONS =
    prejudgeCitationsRaw === ''
      ? true
      : ['1', 'true', 'yes', 'y'].includes(String(prejudgeCitationsRaw).toLowerCase());
  const enableXPostingRaw = optional.ENABLE_X_POSTING;
  config.ENABLE_X_POSTING =
    enableXPostingRaw === ''
      ? false
      : ['1', 'true', 'yes', 'y'].includes(String(enableXPostingRaw).toLowerCase());

  config.RESEND_API_KEY = (optional.RESEND_API_KEY ?? '').trim();
  config.RESEND_AUDIENCE_ID = (optional.RESEND_AUDIENCE_ID ?? '').trim();
  config.RESEND_AUDIENCE_FINANCIAL_SERVICES = (
    optional.RESEND_AUDIENCE_FINANCIAL_SERVICES ?? ''
  ).trim();
  config.RESEND_AUDIENCE_TECH_AI_LEGAL = (optional.RESEND_AUDIENCE_TECH_AI_LEGAL ?? '').trim();
  config.RESEND_WEBHOOK_SECRET = (optional.RESEND_WEBHOOK_SECRET ?? '').trim();
  config.NEWSLETTER_TOKEN_SECRET = (optional.NEWSLETTER_TOKEN_SECRET ?? '').trim();
  config.NEWSLETTER_SITE_URL = (optional.NEWSLETTER_SITE_URL ?? 'https://fintechlaw.ai').trim();
  const resendFrom =
    (optional.RESEND_FROM ?? '').trim() ||
    (optional.RESEND_FROM_EMAIL ?? '').trim() ||
    'FinTech Law <newsletter@fintechlaw.ai>';
  config.RESEND_FROM = resendFrom;
  config.RESEND_FROM_EMAIL = resendFrom;
  config.NEWSLETTER_TEST_EMAIL = (optional.NEWSLETTER_TEST_EMAIL ?? '').trim();
  config.NEWSLETTER_TASK_SECRET = (optional.NEWSLETTER_TASK_SECRET ?? '').trim();
  config.FINTECHLAW_LOGO_URL = (optional.FINTECHLAW_LOGO_URL ?? '').trim();
  config.SLACK_CMO_BO_CHANNEL_ID =
    (optional.SLACK_CMO_BO_CHANNEL_ID ?? '').trim() || 'C0BB9U7AN0Y';
  const enableNewsletterRaw = optional.ENABLE_NEWSLETTER;
  config.ENABLE_NEWSLETTER =
    enableNewsletterRaw === ''
      ? false
      : ['1', 'true', 'yes', 'y'].includes(String(enableNewsletterRaw).toLowerCase());
  config.CMO_ASSEMBLE_URL = (optional.CMO_ASSEMBLE_URL ?? '').trim();

  // Fleet Supabase (ftl-agents / wrxuyabngyaiujgcfexj) — newsletter, subscribers, agent_tasks.
  // Content pipeline keeps SUPABASE_URL + SUPABASE_SERVICE_KEY on the content project.
  config.SUPABASE_FLEET_URL = (optional.SUPABASE_FLEET_URL ?? '').trim();
  config.SUPABASE_FLEET_SERVICE_KEY = (optional.SUPABASE_FLEET_SERVICE_KEY ?? '').trim();

  success('validateEnv', { port, nodeEnv });
  return config;
}
