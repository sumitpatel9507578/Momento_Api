const postModel = require("../models/postModel");
const userModel = require("../models/userModel");
const attachChatSocket = require("../services/chatSocket");
const { isValidMessageType } = require("../utils/messageTypes");

function isPositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}

function isValidMediaUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function uploadMessageAttachment(req, res) {
  const file = req.file;
  if (!file?.path) {
    return res.status(400).json({
      success: false,
      message: "An image or video file is required",
    });
  }
  const messageType = file.mimetype?.startsWith("image/")
    ? "image"
    : file.mimetype?.startsWith("video/")
      ? "video"
      : null;
  if (!messageType) {
    return res.status(400).json({
      success: false,
      message: "Only image and video attachments are supported",
    });
  }

  return res.status(201).json({
    success: true,
    message: "Chat attachment uploaded successfully",
    data: { mediaUrl: file.path, messageType },
  });
}

async function createMessage(req, res) {
  try {
    const { receiverId, message, messageType, mediaUrl } = req.body;
    const rawReelId = req.body.reelId ?? req.body.reel_id;
    const rawPostId = req.body.postId ?? req.body.post_id;
    const numericReceiverId = Number(receiverId);
    const senderId = Number(req.user?.id);
    const resolvedMessageType = messageType || "text";
    const content = typeof message === "string" ? message : "";
    const reelId = rawReelId == null ? null : Number(rawReelId);
    const postId = rawPostId == null ? null : Number(rawPostId);
    const clientMessageId = req.body.clientMessageId ?? null;
    const postImageUrl =
      req.body.postImageUrl ?? req.body.post_image_url ?? null;
    const postCaption = req.body.postCaption ?? req.body.post_caption ?? null;
    const postOwnerUsername =
      req.body.postOwnerUsername ?? req.body.post_owner_username ?? null;

    if (
      !isPositiveInteger(receiverId) ||
      !isPositiveInteger(senderId) ||
      ((typeof message !== "string" || !content.trim()) &&
        !mediaUrl &&
        resolvedMessageType !== "post")
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid receiverId and message content are required",
      });
    }

    if (numericReceiverId === senderId) {
      return res
        .status(400)
        .json({ success: false, message: "You cannot message yourself" });
    }

    if (!isValidMessageType(resolvedMessageType)) {
      return res
        .status(400)
        .json({ success: false, message: "Unsupported message type" });
    }
    if (
      (resolvedMessageType === "reel" &&
        (!Number.isSafeInteger(reelId) || reelId <= 0)) ||
      (resolvedMessageType !== "reel" && reelId !== null) ||
      (resolvedMessageType === "post" &&
        (!Number.isSafeInteger(postId) || postId <= 0)) ||
      (resolvedMessageType !== "post" && postId !== null)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A positive reelId or postId is required only for its message type",
      });
    }

    if (
      clientMessageId !== null &&
      (typeof clientMessageId !== "string" || clientMessageId.length > 64)
    ) {
      return res.status(400).json({
        success: false,
        message: "clientMessageId must be at most 64 characters",
      });
    }

    if (
      mediaUrl !== undefined &&
      mediaUrl !== null &&
      !isValidMediaUrl(mediaUrl)
    ) {
      return res.status(400).json({
        success: false,
        message: "mediaUrl must be a valid HTTP or HTTPS URL",
      });
    }

    const sender = await userModel.getUserById(senderId);
    if (!sender) {
      return res.status(401).json({
        success: false,
        message: "Your account is not available on this server. Sign in again.",
      });
    }

    const receiver = await userModel.getUserById(numericReceiverId);
    if (!receiver) {
      return res
        .status(404)
        .json({ success: false, message: "Receiver not found" });
    }

    const createdMessage = await postModel.createMessage(
      senderId,
      numericReceiverId,
      content,
      resolvedMessageType,
      mediaUrl || null,
      reelId,
      clientMessageId,
      postId,
      postImageUrl,
      postCaption,
      postOwnerUsername,
    );
    attachChatSocket.emitMessage(senderId, numericReceiverId, createdMessage);

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: createdMessage,
    });
  } catch (error) {
    console.error("Create message error:", error);
    if (error.code === "REEL_MESSAGE_MIGRATION_REQUIRED") {
      return res.status(503).json({
        success: false,
        message:
          "Sharing reels in messages requires the approved database migration",
      });
    }
    if (
      error.code === "POST_MESSAGE_MIGRATION_REQUIRED" ||
      error.code === "CHAT_IDEMPOTENCY_MIGRATION_REQUIRED"
    ) {
      return res.status(503).json({
        success: false,
        message: "Apply the chat messages database migration before sending",
      });
    }
    if (error.code === "SHARED_POST_NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === "INVALID_POST_MESSAGE") {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === "SHARED_REEL_NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === "INVALID_REEL_MESSAGE") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res
      .status(500)
      .json({ success: false, message: "Failed to send message" });
  }
}

async function getMessages(req, res) {
  try {
    const receiverId = Number(req.params.userId);
    const senderId = Number(req.user?.id);
    if (!isPositiveInteger(receiverId)) {
      return res
        .status(400)
        .json({ success: false, message: "userId must be a positive integer" });
    }
    if (!isPositiveInteger(senderId)) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid authenticated user" });
    }
    if (receiverId === senderId) {
      return res.status(400).json({
        success: false,
        message: "You cannot open a conversation with yourself",
      });
    }

    const receiver = await userModel.getUserById(receiverId);
    if (!receiver) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const paginated =
      req.query.beforeId !== undefined || req.query.limit !== undefined;
    let pagination = null;
    if (paginated) {
      const beforeId =
        req.query.beforeId === undefined ? null : Number(req.query.beforeId);
      const requestedLimit =
        req.query.limit === undefined ? 30 : Number(req.query.limit);
      if (
        (beforeId !== null && !isPositiveInteger(beforeId)) ||
        !Number.isSafeInteger(requestedLimit) ||
        requestedLimit <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "beforeId and limit must be positive integers",
        });
      }
      pagination = { beforeId, limit: Math.min(requestedLimit, 100) };
    }

    const result = await postModel.getMessages(
      senderId,
      receiverId,
      pagination,
    );
    if (!paginated) {
      return res.status(200).json({ success: true, data: result });
    }
    return res.status(200).json({
      success: true,
      data: result.messages,
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error("Get messages error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch messages" });
  }
}

async function getConversations(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!isPositiveInteger(userId)) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid authenticated user" });
    }

    const conversations = await postModel.getConversations(userId);
    return res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    console.error("Get conversations error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch conversations" });
  }
}

module.exports = {
  uploadMessageAttachment,
  createMessage,
  getMessages,
  getConversations,
};
