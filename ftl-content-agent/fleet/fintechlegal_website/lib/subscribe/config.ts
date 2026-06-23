import { SITE_URL } from './constants.js';

export type SubscribeConfig = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  resendApiKey: string;
  resendFrom: string;
  audienceFinancialServices: string;
  audienceTechAiLegal: string;
  tokenSecret: string;
  siteUrl: string;
  fintechlawLogoUrl: string;
};

export function loadSubscribeConfig(): SubscribeConfig {
  const supabaseUrl = (process.env.SUPABASE_FLEET_URL ?? '').trim();
  const supabaseServiceKey = (process.env.SUPABASE_FLEET_SERVICE_KEY ?? '').trim();
  const resendApiKey = (process.env.RESEND_API_KEY ?? '').trim();
  const resendFrom = (process.env.RESEND_FROM ?? 'newsletter@fintechlaw.ai').trim();
  const audienceFinancialServices = (process.env.RESEND_AUDIENCE_FINANCIAL_SERVICES ?? '').trim();
  const audienceTechAiLegal = (process.env.RESEND_AUDIENCE_TECH_AI_LEGAL ?? '').trim();
  const tokenSecret = (
    process.env.NEWSLETTER_TOKEN_SECRET ??
    process.env.RESEND_WEBHOOK_SECRET ??
    ''
  ).trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_FLEET_URL or SUPABASE_FLEET_SERVICE_KEY');
  }
  if (!tokenSecret) {
    throw new Error('Missing NEWSLETTER_TOKEN_SECRET (or RESEND_WEBHOOK_SECRET fallback)');
  }

  return {
    supabaseUrl,
    supabaseServiceKey,
    resendApiKey,
    resendFrom,
    audienceFinancialServices,
    audienceTechAiLegal,
    tokenSecret,
    siteUrl: (process.env.NEWSLETTER_SITE_URL ?? SITE_URL).replace(/\/+$/, ''),
    fintechlawLogoUrl: (process.env.FINTECHLAW_LOGO_URL ?? '').trim(),
  };
}
