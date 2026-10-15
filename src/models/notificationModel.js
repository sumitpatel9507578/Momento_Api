const db = require("../config/db");

// Get notifications for a user
async function getNotificationsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT n.*, u.username as actorName, u.profile_image as actorImage
     FROM notifications n
     JOIN users u ON n.actor_id = u.id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC`,
    [userId]
  );
  return rows;
}

async function createNotification(userId, actorId, eventType, entityType, entityId) {
  if (Number(userId) === Number(actorId)) return;
  await db.query(
    `INSERT INTO notifications
       (user_id, actor_id, event_type, entity_type, entity_id, is_read)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [userId, actorId, eventType, entityType, entityId],
  );
}

module.exports = {
  getNotificationsByUserId,
  createNotification,
};
