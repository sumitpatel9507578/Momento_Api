-- Review and approve before applying to production.
-- Both tables reference the existing signed BIGINT users/messages/reels IDs.
-- Foreign keys remove bookmarks automatically when the owning user or item is deleted.

ALTER TABLE messages
  MODIFY COLUMN message_type
    ENUM('text', 'image', 'video', 'audio', 'file', 'reel') DEFAULT 'text',
  ADD COLUMN reel_id BIGINT(20) NULL AFTER media_url,
  ADD KEY idx_messages_reel (reel_id),
  ADD CONSTRAINT fk_messages_reel
    FOREIGN KEY (reel_id) REFERENCES reels (id) ON DELETE SET NULL;

CREATE TABLE saved_messages (
  user_id BIGINT(20) NOT NULL,
  message_id BIGINT(20) NOT NULL,
  saved_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, message_id),
  KEY idx_saved_messages_message (message_id),
  CONSTRAINT fk_saved_messages_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_messages_message
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saved_reels (
  user_id BIGINT(20) NOT NULL,
  reel_id BIGINT(20) NOT NULL,
  saved_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, reel_id),
  KEY idx_saved_reels_reel (reel_id),
  CONSTRAINT fk_saved_reels_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_reels_reel
    FOREIGN KEY (reel_id) REFERENCES reels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
