-- 011: Fix the idem_key unique index so it works with ON CONFLICT.
--
-- Migration 010 created the index as PARTIAL (`WHERE idem_key IS NOT NULL`)
-- to skip legacy NULL idem_key rows. Postgres doesn't accept partial indexes
-- as ON CONFLICT targets without explicit predicate matching, which the
-- supabase-js client doesn't expose. Drop the partial form and recreate as
-- a regular unique index. Multiple NULLs are still allowed (default
-- NULLS DISTINCT semantics), so social-poster's existing rows are unaffected.

DROP INDEX IF EXISTS uniq_content_analytics_idem;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_content_analytics_idem
  ON content_analytics (idem_key);
