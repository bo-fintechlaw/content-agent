-- 017: Multi-brand pipeline — brand_id on topics/drafts/index + Rikka categories

ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS brand_id TEXT NOT NULL DEFAULT 'fintechlaw';

ALTER TABLE content_drafts
  ADD COLUMN IF NOT EXISTS brand_id TEXT NOT NULL DEFAULT 'fintechlaw';

ALTER TABLE published_posts_index
  ADD COLUMN IF NOT EXISTS brand_id TEXT NOT NULL DEFAULT 'fintechlaw';

CREATE INDEX IF NOT EXISTS idx_content_topics_brand_status
  ON content_topics (brand_id, status);

CREATE INDEX IF NOT EXISTS idx_content_topics_brand_created
  ON content_topics (brand_id, created_at DESC);

ALTER TABLE content_topics
  DROP CONSTRAINT IF EXISTS content_topics_category_check;

ALTER TABLE content_topics
  ADD CONSTRAINT content_topics_category_check CHECK (category IN (
    'regulatory',
    'financial_services',
    'ai_legal_tech',
    'legal_engineering',
    'crypto',
    'fintech',
    'startup',
    'privacy',
    'data_protection',
    'ai_governance'
  ));
