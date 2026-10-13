-- Run once against the database used by the API.
-- Posts are referenced rather than copied; deleting a post removes its saves.
CREATE TABLE IF NOT EXISTS saved_posts (
  user_id BIGINT(20) NOT NULL,
  post_id BIGINT(20) NOT NULL,
  saved_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, post_id),
  KEY idx_saved_posts_post (post_id),
  CONSTRAINT fk_saved_posts_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_posts_post
    FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
