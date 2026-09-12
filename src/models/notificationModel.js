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

module.exports = {
  getNotificationsByUserId,
};
