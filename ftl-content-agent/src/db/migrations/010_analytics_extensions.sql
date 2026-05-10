-- 010: Extend content_analytics for CSV-imported GSC + LinkedIn metrics.
--
-- Existing columns (impressions, engagements, shares, comments, raw_data,
-- measured_at) stay as-is. We add:
--   - metric_kind  TEXT  : sub-classifies a row inside `platform`
--                          ('gsc_chart_daily' | 'gsc_page' | 'gsc_query'
--                           | 'linkedin_post' | 'linkedin_org_summary')
--   - url          TEXT  : page URL for gsc_page rows / post URL for LinkedIn
--   - query        TEXT  : search query for gsc_query rows
--   - clicks       INT   : GSC clicks (LinkedIn outbound clicks too)
--   - position     NUMERIC(6,2) : GSC average position
--   - period_start DATE  : start of measurement window
--   - period_end   DATE  : end of measurement window
--   - idem_key     TEXT  : deterministic key so re-importing the same CSV
--                          upserts instead of duplicating rows.
--
-- Existing rows (written by social-poster.js) have NULL idem_key and remain
-- unaffected by the partial unique index.

ALTER TABLE content_analytics
  ADD COLUMN IF NOT EXISTS metric_kind  TEXT,
  ADD COLUMN IF NOT EXISTS url          TEXT,
  ADD COLUMN IF NOT EXISTS query        TEXT,
  ADD COLUMN IF NOT EXISTS clicks       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end   DATE,
  ADD COLUMN IF NOT EXISTS idem_key     TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_content_analytics_idem
  ON content_analytics (idem_key)
  WHERE idem_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_analytics_metric_kind
  ON content_analytics (metric_kind, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_content_analytics_url
  ON content_analytics (url)
  WHERE url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_analytics_query
  ON content_analytics (query)
  WHERE query IS NOT NULL;
