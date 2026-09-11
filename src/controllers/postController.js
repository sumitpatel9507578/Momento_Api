const postModel = require("../models/postModel");

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

    if (mediaType && !["image", "video"].includes(mediaType)) {
      return res.status(400).json({
        success: false,
        message: "mediaType must be image or video",
        data: null,
      });
    }

    const post = await postModel.createPost(
      req.user.id,
      caption,
      mediaUrl,
      mediaType,
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

// Like a post once for the authenticated user
async function likePost(req, res) {
  try {
    const postId = Number(req.params.postId);

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid postId is required",
        data: null,
      });
    }

    const post = await postModel.getPostById(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
        data: null,
      });
    }

    const existingLike = await postModel.getLike(req.user.id, postId);

    if (existingLike) {
      return res.status(409).json({
        success: false,
        message: "Post already liked",
        data: null,
      });
    }

    const like = await postModel.createLike(req.user.id, postId);

    return res.status(201).json({
      success: true,
      message: "Post liked successfully",
      data: like,
    });
  } catch (error) {
    console.error("Like post error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to like post",
      data: null,
    });
  }
}

// Add a comment to an existing post
async function createComment(req, res) {
  try {
    const postId = Number(req.params.postId);
    const { comment } = req.body;

    if (!Number.isInteger(postId) || postId <= 0 || !comment) {
      return res.status(400).json({
        success: false,
        message: "A valid postId and comment are required",
        data: null,
      });
    }

    const post = await postModel.getPostById(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
        data: null,
      });
    }

    const createdComment = await postModel.createComment(
      req.user.id,
      postId,
      comment,
    );

    return res.status(201).json({
      success: true,
      message: "Comment created successfully",
      data: createdComment,
    });
  } catch (error) {
    console.error("Create comment error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create comment",
      data: null,
    });
  }
}

module.exports = {
  createComment,
  createPost,
  likePost,
};
