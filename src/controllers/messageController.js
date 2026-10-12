const postModel = require("../models/postModel");
const userModel = require("../models/userModel");

const MESSAGE_TYPES = new Set(["text", "image", "video", "audio", "file"]);

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

async function createMessage(req, res) {
  try {
    const { receiverId, message, messageType, mediaUrl } = req.body;
    const numericReceiverId = Number(receiverId);
    const senderId = Number(req.user?.id);
    const resolvedMessageType = messageType || "text";
    const content = typeof message === "string" ? message : "";

    if (
      !isPositiveInteger(receiverId) ||
      !isPositiveInteger(senderId) ||
      (typeof message !== "string" && !mediaUrl) ||
      (!content.trim() && !mediaUrl)
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid receiverId and message content are required",
      });
    }

    if (numericReceiverId === senderId) {
      return res.status(400).json({ success: false, message: "You cannot message yourself" });
    }

    if (!MESSAGE_TYPES.has(resolvedMessageType)) {
      return res.status(400).json({ success: false, message: "Unsupported message type" });
    }

    if (mediaUrl !== undefined && mediaUrl !== null && !isValidMediaUrl(mediaUrl)) {
      return res.status(400).json({ success: false, message: "mediaUrl must be a valid HTTP or HTTPS URL" });
    }

    const receiver = await userModel.getUserById(numericReceiverId);
    if (!receiver) {
      return res.status(404).json({ success: false, message: "Receiver not found" });
    }

    const createdMessage = await postModel.createMessage(
      senderId,
      numericReceiverId,
      content,
      resolvedMessageType,
      mediaUrl || null,
    );

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: createdMessage,
    });
  } catch (error) {
    console.error("Create message error:", error);
    return res.status(500).json({ success: false, message: "Failed to send message" });
  }
}

async function getMessages(req, res) {
  try {
    const receiverId = Number(req.params.userId);
    const senderId = Number(req.user?.id);
    if (!isPositiveInteger(receiverId)) {
      return res.status(400).json({ success: false, message: "userId must be a positive integer" });
    }
    if (!isPositiveInteger(senderId)) {
      return res.status(401).json({ success: false, message: "Invalid authenticated user" });
    }
    if (receiverId === senderId) {
      return res.status(400).json({ success: false, message: "You cannot open a conversation with yourself" });
    }

    const receiver = await userModel.getUserById(receiverId);
    if (!receiver) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const messages = await postModel.getMessages(senderId, receiverId);
    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch messages" });
  }
}

async function getConversations(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!isPositiveInteger(userId)) {
      return res.status(401).json({ success: false, message: "Invalid authenticated user" });
    }

    const conversations = await postModel.getConversations(userId);
    return res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    console.error("Get conversations error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch conversations" });
  }
}

module.exports = {
  createMessage,
  getMessages,
  getConversations
};
