const userModel = require("../models/userModel");
const followModel = require("../models/followModel");
const db = require("../config/db");
const chatSocket = require("../services/chatSocket");

// Get a user's public profile
async function getProfile(req, res) {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
        data: null,
      });
    }

    const user = await userModel.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: {
        ...user,
        isFollowing: Boolean(await followModel.getFollow(req.user.id, userId)),
        stats: await getProfileStats(userId),
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user profile",
      data: null,
    });
  }
}

// Get the currently authenticated user's profile
async function getMe(req, res) {
  try {
    const user = await userModel.getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: user,
    });
  } catch (error) {
    console.error("GetMe error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user profile",
      data: null,
    });
  }
}

// Update the authenticated user's profile
async function updateProfile(req, res) {
  try {
    const userId = req.params.id ? Number(req.params.id) : req.user.id;

    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own profile",
        data: null,
      });
    }

    const fullName =
      req.body.fullName ?? req.body.full_name ?? req.body.name;
    const updates = {};

    if (fullName !== undefined) updates.fullName = String(fullName).trim();
    if (req.body.username !== undefined) {
      updates.username = String(req.body.username).trim().toLowerCase();
    }
    if (req.body.bio !== undefined) updates.bio = String(req.body.bio).trim();
    if (req.body.website !== undefined) {
      const website = String(req.body.website).trim();
      if (website && (!/^https?:\/\//i.test(website) || website.length > 2048)) {
        return res.status(400).json({ success: false, message: "website must be a valid HTTP or HTTPS URL" });
      }
      updates.website = website || null;
    }
    const uploadedFile =
      req.file ||
      req.files?.profileImage?.[0] ||
      req.files?.profile_image?.[0] ||
      req.files?.profileimage?.[0] ||
      req.files?.image?.[0] ||
      req.files?.file?.[0] ||
      req.files?.media?.[0];
    if (uploadedFile) {
      updates.profileImage = uploadedFile.path;
    } else if (req.body.profileImage !== undefined) {
      const image = String(req.body.profileImage).trim();
      if (image && (!/^https?:\/\//i.test(image) || image.length > 2048)) {
        return res.status(400).json({ success: false, message: "profileImage must be a valid HTTP or HTTPS URL" });
      }
      updates.profileImage = image || null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
        data: null,
      });
    }

    if (
      (updates.fullName !== undefined && !updates.fullName) ||
      (updates.username !== undefined && !updates.username)
    ) {
      return res.status(400).json({
        success: false,
        message: "Name and username cannot be empty",
        data: null,
      });
    }

    await userModel.updateUser(userId, updates);
    const user = await userModel.getUserById(userId);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Username is already taken",
        data: null,
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
      data: null,
    });
  }
}

// Search for users
async function searchUsers(req, res) {
  try {
    const { q } = req.query;
    const users = await userModel.searchUsers(q || "");

    return res.status(200).json({
      success: true,
      message: "Users searched successfully",
      data: users,
    });
  } catch (error) {
    console.error("Search users error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search users",
      data: [],
    });
  }
}

async function getProfileStats(userId) {
  const [rows] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS postsCount,
       (SELECT COUNT(*) FROM reels WHERE user_id = ?) AS reelsCount,
       (SELECT COUNT(*) FROM follows WHERE following_id = ?) AS followersCount,
       (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS followingCount`,
    [userId, userId, userId, userId],
  );
  return rows[0];
}

async function getOnline(req, res) {
  const userId = Number(req.user?.id);
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT f.follower_id AS userId
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ? AND u.show_activity_status = 1
       UNION
       SELECT DISTINCT f.following_id AS userId
       FROM follows f JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = ? AND u.show_activity_status = 1`,
      [userId, userId],
    );
    const onlineIds = new Set(chatSocket.getOnlineUserIds());
    const data = rows
      .filter((row) => onlineIds.has(Number(row.userId)))
      .map((row) => Number(row.userId));
    return res.json({ success: true, data });
  } catch (error) {
    console.error("Get online users error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch online users" });
  }
}

async function updateActivityStatus(req, res) {
  const enabled = req.body?.show_activity_status;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ success: false, message: "show_activity_status must be a boolean" });
  }
  try {
    await db.query("UPDATE users SET show_activity_status = ? WHERE id = ?", [enabled, req.user.id]);
    chatSocket.setActivityVisibility(Number(req.user.id), enabled);
    return res.json({ success: true, data: { show_activity_status: enabled } });
  } catch (error) {
    console.error("Update activity status error:", error);
    return res.status(500).json({ success: false, message: "Failed to update activity status" });
  }
}

module.exports = {
  getProfile,
  getMe,
  updateProfile,
  searchUsers,
  getOnline,
  updateActivityStatus,
};
