-- content_config — FinTech Law Content Agent (architecture spec §4.3)

CREATE TABLE IF NOT EXISTS content_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO content_config (key, value) VALUES
  ('seo_keywords', '["tokenization", "digital assets", "cryptocurrency regulation", "money transmitter", "fintech compliance", "fintech startup", "AI legal tech", "startup legal", "terms of service", "privacy policy", "SEC enforcement", "CFPB regulation"]'::jsonb),
  ('rss_feeds', '{"regulatory": ["https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=&dateb=&owner=include&count=40&search_text=&action=getcompany&RSS"], "ai_legal_tech": ["https://www.artificiallawyer.com/feed/"], "startup": ["https://techcrunch.com/tag/legal/feed/"], "crypto": ["https://www.coindesk.com/arc/outboundfeeds/rss/"]}'::jsonb),
  ('schedule', '{"scan_time": "06:00", "timezone": "America/New_York", "linkedin_post_time": "10:00", "x_post_time": "12:00"}'::jsonb),
  ('voice_examples', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;
