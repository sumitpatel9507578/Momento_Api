const postModel = require("../models/postModel");

// Create a reel for the authenticated user
async function createReel(req, res) {
  try {
    const { caption, songId } = req.body;
    let videoUrl = req.body.videoUrl;

    if (req.file) {
      videoUrl = `/uploads/${req.file.filename}`;
    }

    if (!videoUrl) {
      return res.status(400).json({
        success: false,
        message: "video file is required",
        data: null,
      });
    }

    const reel = await postModel.createReel(
      req.user.id,
      videoUrl,
      caption,
      songId,
    );

    return res.status(201).json({
      success: true,
      message: "Reel created successfully",
      data: reel,
    });
  } catch (error) {
    console.error("Create reel error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create reel",
      data: null,
    });
  }
}

// Create a story that expires after the supplied or default duration
async function createStory(req, res) {
  try {
    const { mediaType, caption, expiresAt } = req.body;
    let mediaUrl = req.body.mediaUrl;

    if (req.file) {
      mediaUrl = `/uploads/${req.file.filename}`;
    }

    if (!mediaUrl) {
      return res.status(400).json({
        success: false,
        message: "media file is required",
        data: null,
      });
    }

    if (mediaType && !["image", "video"].includes(mediaType)) {
      return res.status(400).json({
        success: false,
        message: "mediaType must be image or video",
        data: null,
      });
    }

    const expiration = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (Number.isNaN(expiration.getTime())) {
      return res.status(400).json({
        success: false,
        message: "expiresAt must be a valid date",
        data: null,
      });
    }

    const story = await postModel.createStory(
      req.user.id,
      mediaUrl,
      mediaType,
      caption,
      expiration,
    );

    return res.status(201).json({
      success: true,
      message: "Story created successfully",
      data: story,
    });
  } catch (error) {
    console.error("Create story error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create story",
      data: null,
    });
  }
}

module.exports = {
  createReel,
  createStory,
};
