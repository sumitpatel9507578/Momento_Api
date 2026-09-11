const followModel = require("../models/followModel");
const userModel = require("../models/userModel");

// Follow another user while preventing self-follows and duplicates
async function followUser(req, res) {
  try {
    const targetUserId = Number(req.params.userId);

    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid userId is required",
        data: null,
      });
    }

    if (req.user.id === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot follow yourself",
        data: null,
      });
    }

    const existingFollow = await followModel.getFollow(
      req.user.id,
      targetUserId,
    );

    const targetUser = await userModel.getUserById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Target user not found",
        data: null,
      });
    }
    if (existingFollow) {
      // Toggle: If already following, unfollow
      await followModel.deleteFollow(req.user.id, targetUserId);
      return res.status(200).json({
        success: true,
        message: "User unfollowed successfully",
        isFollowing: false,
      });
    }

    await followModel.createFollow(req.user.id, targetUserId);

    return res.status(201).json({
      success: true,
      message: "User followed successfully",
      isFollowing: true,
    });
  } catch (error) {
    console.error("Follow toggle error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update follow status",
      data: null,
    });
  }
}

module.exports = {
  followUser,
};
