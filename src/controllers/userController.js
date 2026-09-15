const userModel = require("../models/userModel");

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
    const userId = Number(req.params.id);

    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own profile",
        data: null,
      });
    }

    const { fullName, bio } = req.body;
    const updates = {};

    if (fullName) updates.full_name = fullName;
    if (bio) updates.bio = bio;
    if (req.file) {
      updates.profile_image = req.file.path;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
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

module.exports = {
  getMe,
  updateProfile,
  searchUsers,
};
