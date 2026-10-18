CREATE TABLE IF NOT EXISTS report_review_history (
  id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  report_id BIGINT(20) UNSIGNED NOT NULL,
  previous_status VARCHAR(30) NOT NULL,
  new_status VARCHAR(30) NOT NULL,
  admin_id BIGINT(20) UNSIGNED NOT NULL,
  admin_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_report_review_history_report (report_id, created_at),
  KEY idx_report_review_history_admin (admin_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
