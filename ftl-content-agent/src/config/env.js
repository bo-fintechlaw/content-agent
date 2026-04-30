import { fail, start, success } from '../utils/logger.js';

/** xAI api.x.ai key for Grok Imagine (not Twitter’s X_API_KEY). Used by one-off scripts without full validateEnv. */
export function xaiKeyFromProcessEnv() {
  return (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
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
  'PRODUCTION_TRIGGER_SECRET',
  'NOTION_MCP_URL',
  'NOTION_MCP_AUTH_TOKEN',
  'SANITY_MCP_URL',
  'NOTION_TOKEN',
  'NOTION_DB_CONTENT_CALENDAR',
  'NOTION_DB_REGULATORY_TRACKER',
  'NOTION_DB_ACTIVITY_LOG',
  'APP_BASE_URL',
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

  const config = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: optional.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
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
    APP_BASE_URL: optional.APP_BASE_URL?.trim() ?? '',
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

  config.PRODUCTION_TRIGGER_SECRET = (optional.PRODUCTION_TRIGGER_SECRET ?? '').trim();
  const enableXPostingRaw = optional.ENABLE_X_POSTING;
  config.ENABLE_X_POSTING =
    enableXPostingRaw === ''
      ? false
      : ['1', 'true', 'yes', 'y'].includes(String(enableXPostingRaw).toLowerCase());

  success('validateEnv', { port, nodeEnv });
  return config;
}
