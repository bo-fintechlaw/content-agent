-- content_drafts — FTL Content Agent architecture spec §4 / migrations prompt

CREATE TABLE IF NOT EXISTS content_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES content_topics(id),
  blog_title TEXT,
  blog_slug TEXT,
  blog_body JSONB,
  blog_seo_title TEXT,
  blog_seo_description TEXT,
  blog_seo_keywords TEXT,
  blog_category TEXT,
  blog_tags TEXT,
  linkedin_post TEXT,
  x_post TEXT,
  x_thread JSONB,
  image_prompt TEXT,
  image_generated BOOLEAN DEFAULT FALSE,
  judge_scores JSONB,
  judge_pass BOOLEAN,
  judge_flags TEXT[],
  revision_count INTEGER DEFAULT 0,
  sanity_document_id TEXT,
  linkedin_post_id TEXT,
  x_post_id TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_topic_id ON content_drafts (topic_id);
CREATE INDEX IF NOT EXISTS idx_content_drafts_created_at ON content_drafts (created_at DESC);
