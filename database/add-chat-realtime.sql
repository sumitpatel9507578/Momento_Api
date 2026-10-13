-- Run once against the database used by the API before deploying realtime chat.
-- The client ID makes queued messages safe to retry after reconnecting.
ALTER TABLE messages
  ADD COLUMN client_message_id VARCHAR(64) NULL AFTER message_type,
  ADD UNIQUE KEY uq_messages_sender_client_id (sender_id, client_message_id);
