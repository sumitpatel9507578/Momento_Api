const postModel = require("../models/postModel");
const userModel = require("../models/userModel");
const db = require("../config/db");
const notificationModel = require("../models/notificationModel");

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

    if (typeof mediaUrl !== "string" || mediaUrl.length > 14_000_000) {
      return res.status(400).json({
        success: false,
        message: "A valid mediaUrl or uploaded story file is required",
      });
    }
    if (mediaUrl.startsWith("data:")) {
      const dataUrl = mediaUrl.match(
        /^data:(image\/(?:jpeg|png|gif|webp|avif)|video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/]*={0,2})$/,
      );
      if (
        !dataUrl ||
        dataUrl[2].length === 0 ||
        dataUrl[2].length % 4 === 1 ||
        Buffer.from(dataUrl[2], "base64").length > 10 * 1024 * 1024 ||
        (dataUrl[1].startsWith("image/") && resolvedMediaType !== "image") ||
        (dataUrl[1].startsWith("video/") && resolvedMediaType !== "video")
      ) {
        return res.status(400).json({
          success: false,
          message: "mediaUrl must be a valid base64 image or video matching mediaType",
        });
      }
    } else {
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
    }

    if (!["image", "video"].includes(resolvedMediaType)) {
      return res.status(400).json({
        success: false,
        message: "mediaType must be image or video",
      });
    }
    let parsedLayers;
    let parsedMentions;
    let parsedHiddenIds;
    try {
      parsedLayers = typeof layers === "string" ? JSON.parse(layers) : (layers || []);
      parsedMentions = typeof mentions === "string" ? JSON.parse(mentions) : (mentions || []);
      parsedHiddenIds = typeof hideFromUserIds === "string"
        ? JSON.parse(hideFromUserIds)
        : (hideFromUserIds || []);
    } catch {
      return res.status(400).json({ success: false, message: "layers, mentions, and hideFromUserIds must contain valid JSON" });
    }
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
    const parseBoolean = (value) => value === "true" ? true : value === "false" ? false : value;
    const aiGenerated = parseBoolean(isAiGenerated);
    const repliesAllowed = parseBoolean(allowReplies);
    const sharingAllowed = parseBoolean(allowSharing);
    if (typeof aiGenerated !== "undefined" && typeof aiGenerated !== "boolean") {
      return res.status(400).json({ success: false, message: "isAiGenerated must be a boolean" });
    }
    if (typeof repliesAllowed !== "undefined" && typeof repliesAllowed !== "boolean") {
      return res.status(400).json({ success: false, message: "allowReplies must be a boolean" });
    }
    if (typeof sharingAllowed !== "undefined" && typeof sharingAllowed !== "boolean") {
      return res.status(400).json({ success: false, message: "allowSharing must be a boolean" });
    }
    if ((selectedMusic != null && (typeof selectedMusic !== "string" || selectedMusic.length > 255)) ||
        (altText != null && (typeof altText !== "string" || altText.length > 500))) {
      return res.status(400).json({ success: false, message: "selectedMusic or altText is invalid" });
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
    if (relatedUserIds.length) {
      const uniqueIds = [...new Set(relatedUserIds)];
      const [relatedUsers] = await db.query(
        `SELECT id FROM users WHERE id IN (${uniqueIds.map(() => "?").join(", ")})`,
        uniqueIds,
      );
      if (relatedUsers.length !== uniqueIds.length) {
        return res.status(400).json({ success: false, message: "mentions and hideFromUserIds must reference existing users" });
      }
    }

    const storyId = await postModel.createStory(
      userId,
      mediaUrl,
      resolvedMediaType,
      caption ?? "",
      expiration,
      {
        layers: parsedLayers,
        selectedMusic,
        mentions: parsedMentions,
        isAiGenerated: aiGenerated,
        audience,
        hideFromUserIds: parsedHiddenIds,
        allowReplies: repliesAllowed,
        allowSharing: sharingAllowed,
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
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Mark story viewed error:", error);
    return res.status(500).json({ success: false, message: "Failed to mark story as viewed" });
  }
}

async function likeStory(req, res) {
  const storyId = Number(req.params.storyId);
  if (!Number.isSafeInteger(storyId) || storyId <= 0) {
    return res.status(400).json({
      success: false,
      message: "A valid story ID is required",
      isLiked: false,
    });
  }

  try {
    const userId = Number(req.user.id);
    const likeStatus = await postModel.getStoryLikeStatus(storyId, userId);
    if (!likeStatus) {
      return res.status(404).json({
        success: false,
        message: "Active story not found",
        isLiked: false,
      });
    }

    if (likeStatus.likedByUser !== null) {
      await postModel.deleteStoryLike(storyId, userId);
      const updatedLikeStatus = await postModel.getStoryLikeStatus(
        storyId,
        userId,
      );
      if (!updatedLikeStatus) {
        return res.status(404).json({
          success: false,
          message: "Active story not found",
          isLiked: false,
        });
      }
      return res.status(200).json({
        success: true,
        isLiked: false,
        likesCount: Number(updatedLikeStatus.likesCount) || 0,
      });
    }

    await postModel.createStoryLike(storyId, userId);
    const updatedLikeStatus = await postModel.getStoryLikeStatus(
      storyId,
      userId,
    );
    if (!updatedLikeStatus) {
      return res.status(404).json({
        success: false,
        message: "Active story not found",
        isLiked: false,
      });
    }
    await notificationModel.createNotification(
      likeStatus.ownerId,
      userId,
      "like",
      "story",
      storyId,
    );
    return res.status(200).json({
      success: true,
      isLiked: updatedLikeStatus.likedByUser !== null,
      likesCount: Number(updatedLikeStatus.likesCount) || 0,
    });
  } catch (error) {
    console.error("Story like error:", error);
    if (error.code === "ER_NO_SUCH_TABLE") {
      return res.status(503).json({
        success: false,
        message: "Story likes require a database migration before they can be used",
        isLiked: false,
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to update story like",
      isLiked: false,
    });
  }
}

async function getStoryViewers(req, res) {
  const storyId = Number(req.params.storyId);
  if (!Number.isSafeInteger(storyId) || storyId <= 0) {
    return res.status(400).json({
      success: false,
      message: "A valid story ID is required",
    });
  }

  try {
    const viewers = await postModel.getStoryViewers(
      storyId,
      Number(req.user.id),
      req.user.role === "admin",
    );
    if (viewers === null) {
      return res.status(404).json({
        success: false,
        message: "Active story not found",
      });
    }
    if (viewers === false) {
      return res.status(403).json({
        success: false,
        message: "Only the story owner or an admin can view story viewers",
      });
    }
    return res.status(200).json({ success: true, viewers });
  } catch (error) {
    console.error("Get story viewers error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch story viewers",
    });
  }
}

async function deleteStory(req, res) {
  const storyId = Number(req.params.storyId);
  if (!Number.isSafeInteger(storyId) || storyId <= 0) {
    return res.status(400).json({ success: false, message: "A valid story ID is required" });
  }
  try {
    const result = await postModel.deleteStory(
      storyId,
      Number(req.user.id),
      req.user.role === "admin",
    );
    if (result === "not_found") {
      return res.status(404).json({ success: false, message: "Story not found" });
    }
    if (result === "forbidden") {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own story",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Story deleted successfully",
    });
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
  likeStory,
  getStoryViewers,
  deleteStory,
};
