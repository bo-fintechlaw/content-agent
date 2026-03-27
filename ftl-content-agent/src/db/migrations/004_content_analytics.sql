-- content_analytics — FinTech Law Content Agent (architecture spec §4.4)

CREATE TABLE IF NOT EXISTS content_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES content_drafts(id),
  platform TEXT CHECK (platform IN ('blog', 'linkedin', 'x')),
  impressions INTEGER DEFAULT 0,
  engagements INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  measured_at TIMESTAMPTZ DEFAULT NOW(),
  raw_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_content_analytics_draft_id ON content_analytics (draft_id);
CREATE INDEX IF NOT EXISTS idx_content_analytics_measured_at ON content_analytics (measured_at DESC);
