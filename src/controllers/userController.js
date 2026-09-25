const userModel = require("../models/userModel");

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
      data: user,
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

    if (fullName) updates.fullName = fullName;
    if (bio) updates.bio = bio;
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
  getProfile,
  getMe,
  updateProfile,
  searchUsers,
};
