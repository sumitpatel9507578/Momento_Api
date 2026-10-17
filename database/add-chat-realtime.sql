-- Safe to rerun against the database used by the API before deploying chat.
-- The temporary procedure checks information_schema before each schema change.
DELIMITER //
DROP PROCEDURE IF EXISTS ensure_momento_chat_messages//
CREATE PROCEDURE ensure_momento_chat_messages()
BEGIN
  DECLARE matching_index_count INT DEFAULT 0;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'message_type'
  ) THEN
    ALTER TABLE messages
      ADD COLUMN message_type VARCHAR(20) NOT NULL DEFAULT 'text';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'client_message_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN client_message_id VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'reel_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN reel_id BIGINT UNSIGNED NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'post_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN post_id BIGINT UNSIGNED NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'post_image_url'
  ) THEN
    ALTER TABLE messages ADD COLUMN post_image_url VARCHAR(2000) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'post_caption'
  ) THEN
    ALTER TABLE messages ADD COLUMN post_caption TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'post_owner_username'
  ) THEN
    ALTER TABLE messages ADD COLUMN post_owner_username VARCHAR(255) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'is_read'
  ) THEN
    ALTER TABLE messages ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'read_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN read_at DATETIME NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'messages'
      AND column_name = 'message_type' AND data_type = 'enum'
  ) THEN
    ALTER TABLE messages
      MODIFY COLUMN message_type VARCHAR(20) NOT NULL DEFAULT 'text';
  END IF;

  SELECT COUNT(*) INTO matching_index_count
  FROM (
    SELECT index_name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'messages'
    GROUP BY index_name
    HAVING MIN(non_unique) = 0
       AND GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',')
           = 'sender_id,client_message_id'
  ) AS client_id_indexes;
  IF matching_index_count = 0 THEN
    ALTER TABLE messages
      ADD UNIQUE KEY uq_messages_sender_client_id (sender_id, client_message_id);
  END IF;

  SELECT COUNT(*) INTO matching_index_count
  FROM (
    SELECT index_name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'messages'
    GROUP BY index_name
    HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',')
           = 'sender_id,receiver_id,id'
  ) AS conversation_indexes;
  IF matching_index_count = 0 THEN
    ALTER TABLE messages
      ADD KEY idx_messages_sender_receiver_id (sender_id, receiver_id, id);
  END IF;
END//
CALL ensure_momento_chat_messages()//
DROP PROCEDURE ensure_momento_chat_messages//
DELIMITER ;
