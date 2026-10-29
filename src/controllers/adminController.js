const db = require("../config/db");

function isPositiveId(value) {
  return /^[1-9]\d*$/.test(String(value || ""));
}

async function getDashboardStats(req, res) {
  try {
    const [userRows] = await db.query(
      "SELECT COUNT(*) AS totalUsers FROM users",
    );
    const [postRows] = await db.query(
      "SELECT COUNT(*) AS totalPosts FROM posts",
    );
    const [reelRows] = await db.query(
      "SELECT COUNT(*) AS totalReels FROM reels",
    );

    let pendingReports = 0;
    try {
      const [reportRows] = await db.query(
        "SELECT COUNT(*) AS total FROM reports WHERE status = 'pending'",
      );
      pendingReports = Number(reportRows[0]?.total || 0);
    } catch (error) {
      if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    }

    return res.status(200).json({
      success: true,
      data: {
        totalUsers: Number(userRows[0]?.totalUsers || 0),
        totalPosts: Number(postRows[0]?.totalPosts || 0),
        totalReels: Number(reelRows[0]?.totalReels || 0),
        pendingReports,
      },
    });
  } catch (error) {
    console.error("Admin dashboard stats error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard stats",
    });
  }
}

async function toggleBlockUser(req, res) {
  const targetUserId =
    req.params.id ||
    req.body?.userId ||
    req.body?.targetUserId ||
    req.body?.blockedUserId;

  if (!isPositiveId(targetUserId)) {
    return res.status(400).json({
      success: false,
      message: "A valid target user ID is required.",
    });
  }

  let isBlocked = req.body?.isBlocked;
  if (typeof isBlocked === "string")
    isBlocked = isBlocked.toLowerCase() === "true";
  else if (typeof isBlocked !== "boolean") {
    if (req.body?.is_blocked !== undefined) {
      isBlocked = Number(req.body.is_blocked) === 1;
    } else if (req.body?.status !== undefined) {
      isBlocked = String(req.body.status).toLowerCase() === "blocked";
    } else {
      isBlocked = true;
    }
  }

  try {
    const [users] = await db.query(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
      [targetUserId],
    );
    if (!users[0]) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const status = isBlocked ? "blocked" : "active";
    const [result] = await db.query(
      "UPDATE users SET is_blocked = ?, status = ?, is_active = ? WHERE id = ?",
      [isBlocked ? 1 : 0, status, isBlocked ? 0 : 1, targetUserId],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `User #${targetUserId} status updated to ${status}.`,
      data: {
        id: String(targetUserId),
        isBlocked: isBlocked,
        status,
      },
    });
  } catch (error) {
    console.error("Admin toggle block error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update user status",
    });
  }
}

async function toggleVerification(req, res) {
  const userId = req.params.id;
  if (!isPositiveId(userId)) {
    return res.status(400).json({
      success: false,
      message: "A valid user ID is required.",
    });
  }

  const value = req.body?.isVerified ?? req.body?.is_verified ?? false;
  const isVerified =
    value === true || value === 1 || String(value).toLowerCase() === "true"
      ? 1
      : 0;

  try {
    const [result] = await db.query(
      "UPDATE users SET is_verified = ? WHERE id = ?",
      [isVerified, userId],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    return res.status(200).json({
      success: true,
      message: `User #${userId} verification status updated.`,
    });
  } catch (error) {
    console.error("Admin verification update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update verification status",
    });
  }
}

async function deletePost(req, res) {
  try {
    await db.query("DELETE FROM comments WHERE post_id = ?", [req.params.id]);
    await db.query("DELETE FROM likes WHERE post_id = ?", [req.params.id]);
    const [result] = await db.query("DELETE FROM posts WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Post not found" });
    }
    return res.status(200).json({
      success: true,
      message: "Post deleted by Admin.",
    });
  } catch (error) {
    console.error("Admin delete post error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete post",
    });
  }
}

async function deleteReel(req, res) {
  try {
    const [result] = await db.query("DELETE FROM reels WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }
    return res.status(200).json({
      success: true,
      message: "Reel deleted by Admin.",
    });
  } catch (error) {
    console.error("Admin delete reel error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete reel",
    });
  }
}

async function deleteUser(req, res) {
  if (!isPositiveId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: "A valid user ID is required.",
    });
  }
  try {
    await db.query("DELETE FROM posts WHERE user_id = ?", [req.params.id]);
    await db.query("DELETE FROM reels WHERE user_id = ?", [req.params.id]);
    const [result] = await db.query("DELETE FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "User deleted permanently by Admin.",
    });
  } catch (error) {
    console.error("Admin delete user error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete user",
    });
  }
}

module.exports = {
  getDashboardStats,
  toggleBlockUser,
  toggleVerification,
  deletePost,
  deleteReel,
  deleteUser,
};
