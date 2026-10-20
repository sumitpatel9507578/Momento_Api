const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const db = require("../config/db");

router.use(authMiddleware, adminMiddleware);

router.get("/stats", async (req, res) => {
  try {
    // Count only regular users (exclude admins)
    const [userRows] = await db.query(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'user' OR role IS NULL OR role != 'admin'"
    );
    const [postRows] = await db.query("SELECT COUNT(*) AS total FROM posts");
    const [reelRows] = await db.query("SELECT COUNT(*) AS total FROM reels");
    const [storyRows] = await db.query("SELECT COUNT(*) AS total FROM stories");

    let pendingReports = 0;
    try {
      const [reportRows] = await db.query("SELECT COUNT(*) AS total FROM reports WHERE status = 'pending'");
      pendingReports = reportRows[0]?.total || 0;
    } catch (_) {}

    let pendingVerifications = 0;
    try {
      const [verRows] = await db.query("SELECT COUNT(*) AS total FROM verification_applications WHERE status = 'pending'");
      pendingVerifications = verRows[0]?.total || 0;
    } catch (_) {}

    return res.json({
      success: true,
      data: {
        totalUsers: userRows[0]?.total || 0,
        totalPosts: postRows[0]?.total || 0,
        totalReels: reelRows[0]?.total || 0,
        totalStories: storyRows[0]?.total || 0,
        pendingReports,
        pendingVerifications,
      }
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch dashboard stats" });
  }
});

module.exports = router;
