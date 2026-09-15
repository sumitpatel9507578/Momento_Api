const postModel = require("../models/postModel");

// Get reels feed
async function getReels(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const reels = await postModel.getReels(limit, offset);

    return res.status(200).json({
      success: true,
      message: "Reels fetched successfully",
      data: reels,
    });
  } catch (error) {
    console.error("Get reels error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch reels", data: [] });
  }
}

// Get user reels
async function getUserReels(req, res) {
  try {
    const userId = req.params.userId;
    const reels = await postModel.getReelsByUserId(userId);

    return res.status(200).json({
      success: true,
      message: "User reels fetched successfully",
      data: reels,
    });
  } catch (error) {
    console.error("Get user reels error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user reels",
      data: [],
    });
  }
}

// Create a reel
async function createReel(req, res) {
  try {
    const { caption, songId } = req.body;
    let videoUrl = req.body.videoUrl;
    const uploadedFile =
      req.file ||
      req.files?.video?.[0] ||
      req.files?.media?.[0] ||
      req.files?.file?.[0];

    if (uploadedFile) {
      console.log("[REEL] Uploaded file field:", uploadedFile.fieldname);
      videoUrl = uploadedFile.path;
    }

    if (!videoUrl) {
      return res
        .status(400)
        .json({ success: false, message: "video file is required" });
    }

    const reelId = await postModel.createReel(
      req.user.id,
      videoUrl,
      caption,
      songId,
    );

    return res.status(201).json({
      success: true,
      message: "Reel created successfully",
      data: { id: reelId },
    });
  } catch (error) {
    console.error("Create reel error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create reel" });
  }
}

// Get active stories
async function getStories(req, res) {
  try {
    const stories = await postModel.getActiveStories();
    return res.status(200).json({
      success: true,
      message: "Stories fetched successfully",
      data: stories,
    });
  } catch (error) {
    console.error("Get stories error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch stories", data: [] });
  }
}

// Create a story
async function createStory(req, res) {
  try {
    const { mediaType, caption, expiresAt } = req.body;
    let mediaUrl = req.body.mediaUrl;

    if (req.file) {
      mediaUrl = req.file.path;
    }

    if (!mediaUrl) {
      return res
        .status(400)
        .json({ success: false, message: "media file is required" });
    }

    const expiration = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const storyId = await postModel.createStory(
      req.user.id,
      mediaUrl,
      mediaType || "image",
      caption,
      expiration,
    );

    return res.status(201).json({
      success: true,
      message: "Story created successfully",
      data: { id: storyId },
    });
  } catch (error) {
    console.error("Create story error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create story" });
  }
}

module.exports = {
  getReels,
  getUserReels,
  createReel,
  getStories,
  createStory,
};
