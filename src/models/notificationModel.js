const db = require("../config/db");

// Get notifications that belong to the authenticated user
async function getNotificationsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT id, user_id, actor_id, type, reference_id, message, is_read, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId],
  );

  return rows;
}

module.exports = {
  getNotificationsByUserId,
};
