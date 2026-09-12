const postModel = require("../models/postModel");
const userModel = require("../models/userModel");

async function createMessage(req, res) {
  try {
    const { receiverId, message, messageType } = req.body;
    const numericReceiverId = Number(receiverId);

    if (!Number.isInteger(numericReceiverId) || numericReceiverId <= 0 || !message) {
      return res.status(400).json({ success: false, message: "receiverId and message are required" });
    }

    if (numericReceiverId === req.user.id) {
      return res.status(400).json({ success: false, message: "You cannot message yourself" });
    }

    const receiver = await userModel.getUserById(numericReceiverId);
    if (!receiver) {
      return res.status(404).json({ success: false, message: "Receiver not found" });
    }

    const createdMessage = await postModel.createMessage(
      req.user.id,
      numericReceiverId,
      message,
      messageType || "text"
    );

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: createdMessage,
    });
  } catch (error) {
    console.error("Create message error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to send message" });
  }
}

async function getMessages(req, res) {
  try {
    const receiverId = req.params.userId;
    const messages = await postModel.getMessages(req.user.id, receiverId);
    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch messages" });
  }
}

async function getConversations(req, res) {
  try {
    const conversations = await postModel.getConversations(req.user.id);
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
