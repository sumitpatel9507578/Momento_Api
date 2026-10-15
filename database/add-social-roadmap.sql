-- Run once against the API database before deploying the extended roadmap APIs.
-- Existing core tables (users, follows, posts, likes, comments, reels, stories,
-- messages, notifications) and saved-item tables are reused.

ALTER TABLE users
  ADD COLUMN website VARCHAR(2048) NULL,
  ADD COLUMN show_activity_status TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE comments
  ADD COLUMN parent_comment_id BIGINT(20) NULL,
  ADD KEY idx_comments_parent (parent_comment_id),
  ADD CONSTRAINT fk_comments_parent
    FOREIGN KEY (parent_comment_id) REFERENCES comments (id) ON DELETE CASCADE;

ALTER TABLE stories
  ADD COLUMN layers JSON NULL,
  ADD COLUMN selected_music VARCHAR(255) NULL,
  ADD COLUMN is_ai_generated TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN audience ENUM('followers', 'close_friends') NOT NULL DEFAULT 'followers',
  ADD COLUMN allow_replies TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN allow_sharing TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN alt_text VARCHAR(500) NULL;

ALTER TABLE notifications
  ADD COLUMN event_type VARCHAR(32) NULL,
  ADD COLUMN entity_type VARCHAR(32) NULL,
  ADD COLUMN entity_id BIGINT(20) NULL,
  ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE close_friends (
  user_id BIGINT(20) NOT NULL,
  friend_id BIGINT(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  KEY idx_close_friends_friend (friend_id),
  CONSTRAINT fk_close_friends_owner
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_close_friends_friend
    FOREIGN KEY (friend_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comment_likes (
  comment_id BIGINT(20) NOT NULL,
  user_id BIGINT(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id),
  KEY idx_comment_likes_user (user_id),
  CONSTRAINT fk_comment_likes_comment
    FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_likes_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE story_views (
  story_id BIGINT(20) NOT NULL,
  user_id BIGINT(20) NOT NULL,
  viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id, user_id),
  KEY idx_story_views_user (user_id),
  CONSTRAINT fk_story_views_story
    FOREIGN KEY (story_id) REFERENCES stories (id) ON DELETE CASCADE,
  CONSTRAINT fk_story_views_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE story_hidden_users (
  story_id BIGINT(20) NOT NULL,
  user_id BIGINT(20) NOT NULL,
  PRIMARY KEY (story_id, user_id),
  KEY idx_story_hidden_user (user_id),
  CONSTRAINT fk_story_hidden_story
    FOREIGN KEY (story_id) REFERENCES stories (id) ON DELETE CASCADE,
  CONSTRAINT fk_story_hidden_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE story_mentions (
  story_id BIGINT(20) NOT NULL,
  user_id BIGINT(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id, user_id),
  KEY idx_story_mentions_user (user_id),
  CONSTRAINT fk_story_mentions_story
    FOREIGN KEY (story_id) REFERENCES stories (id) ON DELETE CASCADE,
  CONSTRAINT fk_story_mentions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_reset_tokens (
  id BIGINT(20) NOT NULL AUTO_INCREMENT,
  user_id BIGINT(20) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_token_hash (token_hash),
  KEY idx_password_reset_user_expiry (user_id, expires_at),
  CONSTRAINT fk_password_reset_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
