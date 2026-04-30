-- 007: Persist pre-generated image asset refs on drafts.
-- Lets draft review include the generated image before publish.

ALTER TABLE content_drafts
ADD COLUMN IF NOT EXISTS image_asset_ref TEXT;
