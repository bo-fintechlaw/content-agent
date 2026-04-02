-- Add social_approved flag to content_drafts.
-- Social posts require separate Slack approval after blog is published to Sanity.

ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS social_approved BOOLEAN DEFAULT NULL;
