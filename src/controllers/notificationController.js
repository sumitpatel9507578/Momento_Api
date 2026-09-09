const notificationModel = require("../models/notificationModel");

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

module.exports = {
  getNotifications,
};
