-- content_topics — FinTech Law Content Agent (architecture spec §4.1)

CREATE TABLE IF NOT EXISTS content_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT,
  source_name TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT CHECK (category IN
    ('regulatory', 'ai_legal_tech', 'startup', 'crypto')),
  relevance_score NUMERIC(3,1),
  status TEXT DEFAULT 'pending' CHECK (status IN
    ('pending', 'ranked', 'drafting', 'judging',
     'review', 'approved', 'published', 'rejected', 'archived')),
  suggested_by TEXT DEFAULT 'scanner',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_topics_status ON content_topics (status);
CREATE INDEX IF NOT EXISTS idx_content_topics_created_at ON content_topics (created_at DESC);
