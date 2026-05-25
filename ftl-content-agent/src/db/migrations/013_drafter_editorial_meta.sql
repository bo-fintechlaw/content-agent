-- 013_drafter_editorial_meta — store the drafter's pre-draft journalist
-- discipline metadata (angle, secondary lens, source-pulled facts) so the
-- judge can verify the body actually pursues the declared angle and includes
-- the declared facts. Not published; used for prompt enforcement only.

ALTER TABLE content_drafts
  ADD COLUMN IF NOT EXISTS editorial_meta JSONB;

COMMENT ON COLUMN content_drafts.editorial_meta IS
  'Drafter pre-draft metadata: { angle: string, secondary_lens: string, facts_from_source: [{ fact, source_url }] }. Used by judge to verify the body pursues the declared angle and includes the declared facts.';
