-- Run once against the database used by the API.
-- Reel likes share the likes table with post likes, so post_id must be nullable.
ALTER TABLE likes
  MODIFY COLUMN post_id BIGINT(20) NULL,
  ADD COLUMN reel_id BIGINT(20) NULL AFTER post_id;
