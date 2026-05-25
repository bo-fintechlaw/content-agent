-- 014_expand_content_topics_category_check — the original constraint in
-- 001_content_topics.sql only allowed ('regulatory', 'ai_legal_tech',
-- 'startup', 'crypto'). The legal_engineering category in sources.js has
-- been silently rejected since it was added; the new financial_services
-- category (RIAs / RICs / VC funds) and renamed fintech category (was
-- 'startup' in the original) need allowlisting before the scanner can
-- ingest their feeds.

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
    -- legacy: pre-rename rows in production still carry 'startup'
    'startup'
  ));
