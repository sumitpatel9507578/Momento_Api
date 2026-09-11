const postModel = require("../models/postModel");
const db = require("../config/db");

// Get home feed
async function getFeed(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const posts = await postModel.getFeed(Number(limit), Number(offset));

    return res.status(200).json({
      success: true,
      message: "Feed fetched successfully",
      data: posts,
    });
  } catch (error) {
    console.error("Get feed error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch feed",
      data: [],
    });
  }
}

// Get posts for a specific user
async function getUserPosts(req, res) {
  try {
    const userId = req.params.userId;
    const posts = await postModel.getPostsByUserId(userId);

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

// Create a post for the authenticated user
async function createPost(req, res) {
  try {
    const { caption, mediaType } = req.body;
    let mediaUrl = req.body.mediaUrl;

    if (req.file) {
      mediaUrl = `/uploads/${req.file.filename}`;
    }

    if (!caption && !mediaUrl) {
      return res.status(400).json({
        success: false,
        message: "Caption or media are required",
        data: null,
      });
    }

    const post = await postModel.createPost(
      req.user.id,
      caption,
      mediaUrl,
      mediaType || 'image',
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
      data: null,
    });
  }
}

// Like/Unlike a post
async function likePost(req, res) {
  try {
    const postId = req.params.postId;
    const existingLike = await postModel.getLike(req.user.id, postId);

    if (existingLike) {
      // If already liked, unlike it
      await db.query("DELETE FROM likes WHERE user_id = ? AND post_id = ?", [req.user.id, postId]);
      return res.status(200).json({ success: true, message: "Unliked" });
    }

    await postModel.createLike(req.user.id, postId);

    return res.status(201).json({
      success: true,
      message: "Liked successfully",
      data: null,
    });
  } catch (error) {
    console.error("Like error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// Add a comment
async function createComment(req, res) {
  try {
    const { postId, reelId } = req.params;
    const { comment } = req.body;

    if (!comment) {
      return res.status(400).json({ success: false, message: "Comment is required" });
    }

    await postModel.createComment(req.user.id, postId, comment, reelId);

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

// Get comments for a post or reel
async function getComments(req, res) {
  try {
    const { postId, reelId } = req.params;
    let comments;

    if (postId) {
      comments = await postModel.getCommentsByPostId(postId);
    } else if (reelId) {
      comments = await postModel.getCommentsByReelId(reelId);
    }

    return res.status(200).json({
      success: true,
      message: "Comments fetched successfully",
      data: comments,
    });
  } catch (error) {
    console.error("Get comments error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch comments",
      data: [],
    });
  }
}

module.exports = {
  getFeed,
  getUserPosts,
  createPost,
  likePost,
  createComment,
  getComments,
};
