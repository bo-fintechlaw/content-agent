-- published_posts_index — searchable index of published FTL blog posts so
-- the drafter can cross-reference its own corpus when a new topic overlaps
-- prior coverage. See FTL_Editorial_Intelligence_v1.md §2.3.
--
-- Why a separate table (vs. querying content_drafts directly):
--   1. We want a frozen snapshot of post metadata at publish time. Drafts
--      mutate (revision_count, judge_flags, etc.); the published canonical
--      should be immutable.
--   2. Postgres FTS on a generated tsvector + GIN index needs a stable shape.
--   3. Future engagement-feedback work (LinkedIn impressions etc.) attaches
--      cleanly to one row per published post.

CREATE TABLE IF NOT EXISTS published_posts_index (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id        UUID NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
  published_url   TEXT NOT NULL,
  blog_title      TEXT NOT NULL,
  blog_slug       TEXT NOT NULL,
  category        TEXT,
  source_name     TEXT,
  first_paragraph TEXT,
  published_at    TIMESTAMPTZ NOT NULL,
  search_tsv      tsvector
                  GENERATED ALWAYS AS (
                    setweight(to_tsvector('english', coalesce(blog_title,'')), 'A') ||
                    setweight(to_tsvector('english', coalesce(first_paragraph,'')), 'B')
                  ) STORED,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- One index row per draft. Re-running publish on the same draft updates the
-- existing row instead of inserting a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_published_posts_index_draft
  ON published_posts_index (draft_id);

CREATE INDEX IF NOT EXISTS idx_published_posts_index_published_at
  ON published_posts_index (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_published_posts_index_search_tsv
  ON published_posts_index USING GIN (search_tsv);
