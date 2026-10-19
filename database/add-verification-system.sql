ALTER TABLE users
  ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE verification_applications (
  id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT(20) UNSIGNED NOT NULL,
  status ENUM('submitted', 'under_review', 'approved', 'rejected')
    NOT NULL DEFAULT 'submitted',
  application_data JSON NOT NULL,
  document_public_id VARCHAR(255) NOT NULL,
  document_resource_type VARCHAR(16) NOT NULL,
  document_format VARCHAR(32) NOT NULL,
  requested_details TEXT NULL,
  resubmit_requested TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_verification_user (user_id, id),
  KEY idx_verification_status_created (status, created_at),
  CONSTRAINT fk_verification_application_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE verification_review_history (
  id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT(20) UNSIGNED NOT NULL,
  admin_id BIGINT(20) UNSIGNED NOT NULL,
  action VARCHAR(24) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_verification_review_application (application_id, created_at),
  KEY idx_verification_review_admin (admin_id, created_at),
  CONSTRAINT fk_verification_review_application
    FOREIGN KEY (application_id) REFERENCES verification_applications (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_verification_review_admin
    FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
