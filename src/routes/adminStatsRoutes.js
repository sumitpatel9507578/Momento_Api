const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const db = require("../config/db");

router.use(authMiddleware, adminMiddleware);

router.get("/", async (req, res) => {
  try {
    const [userRows] = await db.query("SELECT COUNT(*) AS totalUsers FROM users");
    const [postRows] = await db.query("SELECT COUNT(*) AS totalPosts FROM posts");
    const [reelRows] = await db.query("SELECT COUNT(*) AS totalReels FROM reels");

    let totalStories = 0;
    try {
      const [storyRows] = await db.query("SELECT COUNT(*) AS total FROM stories");
      totalStories = storyRows[0]?.total || 0;
    } catch (_) {}

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
        totalUsers: userRows[0]?.totalUsers || 0,
        totalPosts: postRows[0]?.totalPosts || 0,
        totalReels: reelRows[0]?.totalReels || 0,
        totalStories,
        pendingReports,
        pendingVerifications,
      }
    });
  } catch (error) {
    console.error("Admin stats fetch error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch admin stats" });
  }
});

module.exports = router;
