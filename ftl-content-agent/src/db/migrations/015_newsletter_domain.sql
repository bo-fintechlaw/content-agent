-- 015: Newsletter domain tables — issues, subscribers, consent events, send metrics.
-- Fleet Supabase project wrxuyabngyaiujgcfexj (ftl-agents).

CREATE TABLE IF NOT EXISTS newsletter_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('financial_services', 'tech_ai_legal')),
  issue_date DATE NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  issue_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'rendering', 'review', 'approved', 'published', 'discarded', 'failed')
  ),
  agent_task_id UUID,
  agent_action_id UUID,
  sanity_document_id TEXT,
  resend_broadcast_id TEXT,
  web_preview_url TEXT,
  email_test_id TEXT,
  carousel_urls JSONB DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS newsletter_issues_status_idx ON newsletter_issues (status);
CREATE INDEX IF NOT EXISTS newsletter_issues_segment_date_idx ON newsletter_issues (segment, issue_date DESC);

CREATE TABLE IF NOT EXISTS subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (
    status IN ('unconfirmed', 'confirmed', 'unsubscribed', 'suppressed')
  ),
  segments TEXT[] NOT NULL DEFAULT '{}',
  source TEXT,
  resend_contact_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS subscribers_status_idx ON subscribers (status);

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES subscribers (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'imported',
      'opt_in_sent',
      'confirmed',
      'unsubscribed',
      'complained',
      'bounced',
      'suppressed'
    )
  ),
  consent_text TEXT,
  ip_address TEXT,
  source TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_events_subscriber_idx ON subscription_events (subscriber_id, created_at DESC);

CREATE TABLE IF NOT EXISTS issue_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_issue_id UUID REFERENCES newsletter_issues (id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'resend' CHECK (platform IN ('resend', 'linkedin', 'x', 'ga4')),
  metric_kind TEXT NOT NULL,
  value NUMERIC,
  metadata JSONB DEFAULT '{}'::jsonb,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  idem_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_metrics_issue_idx ON issue_metrics (newsletter_issue_id, metric_kind);
