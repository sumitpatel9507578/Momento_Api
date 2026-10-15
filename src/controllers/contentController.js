const postModel = require("../models/postModel");
const userModel = require("../models/userModel");

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

async function getReel(req, res) {
  const reelId = req.params.reelId;
  if (!/^[1-9]\d*$/.test(reelId)) {
    return res.status(400).json({
      success: false,
      message: "A valid reel ID is required",
    });
  }

  try {
    const reel = await postModel.getReelById(reelId);
    if (!reel) {
      return res.status(404).json({
        success: false,
        message: "Reel not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Reel fetched successfully",
      data: reel,
    });
  } catch (error) {
    console.error("Get reel error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reel",
    });
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
    return res.status(500).json({
      success: false,
      message: "Failed to create reel",
      error: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
}

async function deleteReel(req, res) {
  const reelId = req.params.reelId;
  if (!/^[1-9]\d*$/.test(reelId)) {
    return res.status(400).json({
      success: false,
      message: "A valid reel ID is required",
    });
  }

  const userId = Number(req.user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid authenticated user",
    });
  }

  try {
    const deleted = await postModel.deleteReel(reelId, userId);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Reel not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Reel deleted successfully",
    });
  } catch (error) {
    console.error("Delete reel error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete reel",
    });
  }
}

// Get active stories
async function getStories(req, res) {
  try {
    const stories = await postModel.getActiveStories(Number(req.user.id));
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
    const {
      mediaType, caption, expiresAt, layers, selectedMusic, mentions,
      isAiGenerated, audience, hideFromUserIds, allowReplies, allowSharing, altText,
    } = req.body;
    let mediaUrl = req.body.mediaUrl;
    const uploadedFile = req.file || req.files?.story?.[0] || req.files?.media?.[0];
    let resolvedMediaType = mediaType || "image";

    if (uploadedFile) {
      mediaUrl = uploadedFile.path;
      const uploadedMediaType = uploadedFile.mimetype?.startsWith("video/")
        ? "video"
        : uploadedFile.mimetype?.startsWith("image/")
          ? "image"
          : null;
      if (!uploadedMediaType) {
        return res.status(400).json({
          success: false,
          message: "Only image and video story media are supported",
        });
      }
      if (mediaType && mediaType !== uploadedMediaType) {
        return res.status(400).json({
          success: false,
          message: "mediaType does not match the uploaded file",
        });
      }
      resolvedMediaType = uploadedMediaType;
    }

    if (typeof mediaUrl !== "string" || mediaUrl.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "A valid mediaUrl or uploaded story file is required",
      });
    }
    try {
      const parsedMediaUrl = new URL(mediaUrl);
      if (!["http:", "https:"].includes(parsedMediaUrl.protocol)) {
        throw new Error("Unsupported media URL protocol");
      }
    } catch {
      return res.status(400).json({
        success: false,
        message: "mediaUrl must be a valid HTTP or HTTPS URL",
      });
    }

    if (!["image", "video"].includes(resolvedMediaType)) {
      return res.status(400).json({
        success: false,
        message: "mediaType must be image or video",
      });
    }
    const parsedLayers = typeof layers === "string" ? JSON.parse(layers) : (layers || []);
    const parsedMentions = typeof mentions === "string" ? JSON.parse(mentions) : (mentions || []);
    const parsedHiddenIds = typeof hideFromUserIds === "string"
      ? JSON.parse(hideFromUserIds)
      : (hideFromUserIds || []);
    if (!Array.isArray(parsedLayers) || !Array.isArray(parsedMentions) || !Array.isArray(parsedHiddenIds)) {
      return res.status(400).json({ success: false, message: "layers, mentions, and hideFromUserIds must be arrays" });
    }
    if (!["followers", "close_friends"].includes(audience || "followers")) {
      return res.status(400).json({ success: false, message: "audience must be followers or close_friends" });
    }
    const relatedUserIds = [...parsedMentions, ...parsedHiddenIds].map(Number);
    if (relatedUserIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return res.status(400).json({ success: false, message: "mentions and hideFromUserIds must contain valid user IDs" });
    }
    if (typeof isAiGenerated !== "undefined" && typeof isAiGenerated !== "boolean") {
      return res.status(400).json({ success: false, message: "isAiGenerated must be a boolean" });
    }
    if (typeof allowReplies !== "undefined" && typeof allowReplies !== "boolean") {
      return res.status(400).json({ success: false, message: "allowReplies must be a boolean" });
    }
    if (typeof allowSharing !== "undefined" && typeof allowSharing !== "boolean") {
      return res.status(400).json({ success: false, message: "allowSharing must be a boolean" });
    }

    if (
      caption !== undefined &&
      caption !== null &&
      (typeof caption !== "string" || caption.length > 500)
    ) {
      return res.status(400).json({
        success: false,
        message: "caption must be a string no longer than 500 characters",
      });
    }

    const expiration = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (Number.isNaN(expiration.getTime()) || expiration <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "expiresAt must be a valid future date",
      });
    }
    const userId = Number(req.user.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid authenticated user",
      });
    }
    const user = await userModel.getUserById(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found",
      });
    }

    const storyId = await postModel.createStory(
      userId,
      mediaUrl,
      resolvedMediaType,
      caption,
      expiration,
      {
        layers: parsedLayers,
        selectedMusic,
        mentions: parsedMentions,
        isAiGenerated,
        audience,
        hideFromUserIds: parsedHiddenIds,
        allowReplies,
        allowSharing,
        altText,
      },
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

async function viewStory(req, res) {
  const storyId = Number(req.params.storyId);
  if (!Number.isSafeInteger(storyId) || storyId <= 0) {
    return res.status(400).json({ success: false, message: "A valid story ID is required" });
  }
  try {
    const viewed = await postModel.markStoryViewed(storyId, Number(req.user.id));
    if (!viewed) return res.status(404).json({ success: false, message: "Active story not found" });
    return res.json({ success: true, message: "Story marked as viewed" });
  } catch (error) {
    console.error("Mark story viewed error:", error);
    return res.status(500).json({ success: false, message: "Failed to mark story as viewed" });
  }
}

async function deleteStory(req, res) {
  const storyId = Number(req.params.storyId);
  if (!Number.isSafeInteger(storyId) || storyId <= 0) {
    return res.status(400).json({ success: false, message: "A valid story ID is required" });
  }
  try {
    const deleted = await postModel.deleteStory(storyId, Number(req.user.id));
    if (!deleted) return res.status(404).json({ success: false, message: "Story not found" });
    return res.json({ success: true, message: "Story deleted successfully" });
  } catch (error) {
    console.error("Delete story error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete story" });
  }
}

module.exports = {
  getReels,
  getReel,
  getUserReels,
  createReel,
  deleteReel,
  getStories,
  createStory,
  viewStory,
  deleteStory,
};
