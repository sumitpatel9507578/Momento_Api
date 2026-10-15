const postModel = require("../models/postModel");
const db = require("../config/db");

// --- Feed ---
async function getFeed(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const followingOnly = ["true", "1"].includes(String(req.query.following || "").toLowerCase());
    const posts = await postModel.getFeed(limit, offset, req.user.id, followingOnly);

    return res.status(200).json({
      success: true,
      message: "Feed fetched successfully",
      data: posts,
    });
  } catch (error) {
    console.error("Get feed error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch feed", data: [] });
  }
}

async function getUserPosts(req, res) {
  try {
    const userId = req.params.userId;
    const posts = await postModel.getPostsByUserId(userId, req.user.id);

    return res.status(200).json({
      success: true,
      message: "User posts fetched successfully",
      data: posts,
    });
  } catch (error) {
    console.error("Get user posts error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user posts",
      data: [],
    });
  }
}

async function getPost(req, res) {
  const postId = Number(req.params.postId);
  if (!Number.isSafeInteger(postId) || postId <= 0) {
    return res.status(400).json({ success: false, message: "A valid post ID is required" });
  }
  try {
    const post = await postModel.getPostById(postId, Number(req.user.id));
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    return res.json({ success: true, data: post });
  } catch (error) {
    console.error("Get post error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch post" });
  }
}

async function updatePost(req, res) {
  try {
    const postId = Number(req.params.postId);
    const { caption } = req.body;
    if (!Number.isSafeInteger(postId) || postId <= 0 || typeof caption !== "string") {
      return res.status(400).json({
        success: false,
        message: "A valid post ID and caption are required",
      });
    }

    const updated = await postModel.updatePostCaption(
      postId,
      req.user.id,
      caption.trim(),
    );
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Post not found or you do not own it",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Post updated successfully",
      data: { id: postId, caption: caption.trim() },
    });
  } catch (error) {
    console.error("Update post error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update post",
    });
  }
}

async function deletePost(req, res) {
  try {
    const postId = Number(req.params.postId);
    if (!Number.isSafeInteger(postId) || postId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid post ID is required",
      });
    }

    const deleted = await postModel.deletePost(postId, req.user.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Post not found or you do not own it",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Post deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete post error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete post",
    });
  }
}

// --- Creation ---
async function createPost(req, res) {
  try {
    const { caption, mediaType } = req.body;
    let mediaUrl = req.body.mediaUrl;

    if (req.file) {
      mediaUrl = req.file.path;
    }

    if (!caption && !mediaUrl) {
      return res
        .status(400)
        .json({ success: false, message: "Caption or media are required" });
    }

    const post = await postModel.createPost(
      req.user.id,
      caption,
      mediaUrl,
      mediaType || "image",
    );

    return res.status(201).json({
      success: true,
      message: "Post created successfully",
      data: post,
    });
  } catch (error) {
    console.error("Create post error:", error);
    return res.status(500).json({
      success: false,
      message: `Failed to create post: ${error.message}`,
    });
  }
}

// --- Social ---
async function likePost(req, res) {
  try {
    const pId = req.params.postId || req.query.postId || req.body.postId;
    const rId = req.params.reelId || req.query.reelId || req.body.reelId;
    const hasPostId = pId !== undefined && pId !== null && pId !== "";
    const hasReelId = rId !== undefined && rId !== null && rId !== "";

    if (hasPostId === hasReelId) {
      return res.status(400).json({
        success: false,
        message: "Provide exactly one postId or reelId",
        isLiked: false,
      });
    }

    const contentId = Number(hasPostId ? pId : rId);
    if (!Number.isSafeInteger(contentId) || contentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Content ID must be a positive integer",
        isLiked: false,
      });
    }

    const postTargetId = hasPostId ? contentId : null;
    const reelTargetId = hasReelId ? contentId : null;
    const existingLike = await postModel.getLike(
      req.user.id,
      postTargetId,
      reelTargetId,
    );

    if (existingLike) {
      await postModel.deleteLike(req.user.id, postTargetId, reelTargetId);
      return res.status(200).json({
        success: true,
        message: "Unliked",
        isLiked: false,
      });
    }

    await postModel.createLike(req.user.id, postTargetId, reelTargetId);
    return res.status(201).json({
      success: true,
      message: "Liked",
      isLiked: true,
    });
  } catch (error) {
    console.error("Like error:", error);
    if (error.code === "INVALID_LIKE_TARGET") {
      return res.status(400).json({
        success: false,
        message: error.message,
        isLiked: false,
      });
    }
    if (error.code === "LIKE_TARGET_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: error.message,
        isLiked: false,
      });
    }
    if (error.code === "REEL_LIKES_MIGRATION_REQUIRED") {
      return res.status(503).json({
        success: false,
        message: "Reel likes require a database migration before they can be used",
        isLiked: false,
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to update like",
      isLiked: false,
    });
  }
}

async function createComment(req, res) {
  try {
    const { postId, reelId } = req.params;
    const { comment } = req.body;

    if (!comment) {
      return res
        .status(400)
        .json({ success: false, message: "Comment is required" });
    }

    const parentCommentId = req.body.parentCommentId == null
      ? null
      : Number(req.body.parentCommentId);
    if (parentCommentId !== null && (!Number.isSafeInteger(parentCommentId) || parentCommentId <= 0)) {
      return res.status(400).json({ success: false, message: "parentCommentId must be a positive integer" });
    }
    await postModel.createComment(req.user.id, postId, comment, reelId, parentCommentId);

    return res.status(201).json({
      success: true,
      message: "Comment added",
      data: null,
    });
  } catch (error) {
    console.error("Comment error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function getComments(req, res) {
  try {
    const { postId, reelId } = req.params;
    let comments;

    if (postId) {
      comments = await postModel.getCommentsByPostId(postId);
    } else if (reelId) {
      comments = await postModel.getCommentsByReelId(reelId);
    } else {
      return res
        .status(400)
        .json({ success: false, message: "ID is required" });
    }

    return res.status(200).json({
      success: true,
      message: "Comments fetched successfully",
      data: comments,
    });
  } catch (error) {
    console.error("Get comments error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch comments", data: [] });
  }
}

module.exports = {
  getFeed,
  getUserPosts,
  getPost,
  updatePost,
  deletePost,
  createPost,
  likePost,
  createComment,
  getComments,
};
