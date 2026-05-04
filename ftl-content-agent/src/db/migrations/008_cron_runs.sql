-- 008: Persist a row per cron firing so "did the 7am job run?" is a one-URL answer.
-- Captures start, finish, outcome, and a free-form summary or error.
CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  summary JSONB
);

CREATE INDEX IF NOT EXISTS cron_runs_name_started_idx
  ON cron_runs (cron_name, started_at DESC);

CREATE INDEX IF NOT EXISTS cron_runs_started_idx
  ON cron_runs (started_at DESC);
