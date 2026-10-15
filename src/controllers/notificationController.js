const notificationModel = require("../models/notificationModel");
const db = require("../config/db");

// Get notifications for the authenticated user
async function getNotifications(req, res) {
  try {
    const notifications = await notificationModel.getNotificationsByUserId(
      req.user.id,
    );

    return res.status(200).json({
      success: true,
      message: "Notifications fetched successfully",
      data: notifications,
    });
  } catch (error) {
    console.error("Get notifications error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      data: null,
    });
  }
}

async function markRead(req, res) {
  const notificationId = Number(req.params.id);
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
    return res.status(400).json({ success: false, message: "A valid notification ID is required" });
  }
  try {
    const [result] = await db.query(
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
      [notificationId, req.user.id],
    );
    if (!result.affectedRows) {
      const [rows] = await db.query(
        "SELECT id FROM notifications WHERE id = ? AND user_id = ?",
        [notificationId, req.user.id],
      );
      if (!rows.length) return res.status(404).json({ success: false, message: "Notification not found" });
    }
    return res.json({ success: true, data: { id: notificationId, isRead: true } });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({ success: false, message: "Failed to update notification" });
  }
}

module.exports = {
  getNotifications,
  markRead,
};
