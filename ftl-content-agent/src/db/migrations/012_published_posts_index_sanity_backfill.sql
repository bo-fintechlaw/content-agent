-- Allow Sanity-only posts (no agent draft row) into the prior-posts index.
--
-- Migration 009 made draft_id NOT NULL with a foreign key to content_drafts.
-- That rules out posts published before the agent existed (or published
-- manually via the Sanity Studio without a draft row). Drop the NOT NULL so
-- backfill can insert Sanity-only rows with draft_id=null, and add a unique
-- index on blog_slug so the Sanity backfill is idempotent — a re-run skips
-- slugs that are already present (whether sourced from the agent or a prior
-- backfill).

ALTER TABLE published_posts_index
  ALTER COLUMN draft_id DROP NOT NULL;

-- blog_slug is the canonical permalink-stable identifier across both
-- agent-recorded and Sanity-backfilled rows. The existing draft_id unique
-- index stays in place — it still prevents an agent draft from being
-- inserted twice.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_published_posts_index_slug
  ON published_posts_index (blog_slug);
