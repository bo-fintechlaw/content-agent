-- 006: Add 'revision' to content_topics.status CHECK constraint.
-- Required by judge.js (REVISE verdict) and webhooks.js (Request Changes feedback).

ALTER TABLE content_topics DROP CONSTRAINT IF EXISTS content_topics_status_check;
ALTER TABLE content_topics ADD CONSTRAINT content_topics_status_check
  CHECK (status IN (
    'pending', 'ranked', 'drafting', 'judging',
    'review', 'revision', 'approved', 'published',
    'rejected', 'archived'
  ));
