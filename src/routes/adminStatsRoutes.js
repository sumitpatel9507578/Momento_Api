const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const db = require("../config/db");

router.use(authMiddleware, adminMiddleware);

router.get("/", async (req, res) => {
  let totalUsers = 0;
  let totalPosts = 0;
  let totalReels = 0;
  let totalStories = 0;
  let pendingReports = 0;
  let pendingVerifications = 0;

  try {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM users");
    totalUsers = rows[0]?.total || 0;
  } catch (err) {
    console.error("Error counting users:", err.message);
  }

  try {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM posts");
    totalPosts = rows[0]?.total || 0;
  } catch (err) {
    console.error("Error counting posts:", err.message);
  }

  try {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM reels");
    totalReels = rows[0]?.total || 0;
  } catch (err) {
    console.error("Error counting reels:", err.message);
  }

  try {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM stories");
    totalStories = rows[0]?.total || 0;
  } catch (err) {
    console.error("Error counting stories:", err.message);
  }

  try {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM reports WHERE status = 'pending'");
    pendingReports = rows[0]?.total || 0;
  } catch (err) {
    console.error("Error counting reports:", err.message);
  }

  try {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM verification_applications WHERE status = 'pending'");
    pendingVerifications = rows[0]?.total || 0;
  } catch (err) {
    console.error("Error counting verifications:", err.message);
  }

  return res.json({
    success: true,
    data: {
      totalUsers,
      totalPosts,
      totalReels,
      totalStories,
      pendingReports,
      pendingVerifications,
    },
  });
});

module.exports = router;
