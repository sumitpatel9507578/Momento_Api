const postModel = require("../models/postModel");
const userModel = require("../models/userModel");

// Send a message with the sender taken from the verified JWT
async function createMessage(req, res) {
  try {
    const { receiverId, message, messageType } = req.body;
    const numericReceiverId = Number(receiverId);
    const allowedMessageTypes = ["text", "image", "video", "audio", "file"];

    if (
      !Number.isInteger(numericReceiverId) ||
      numericReceiverId <= 0 ||
      !message
    ) {
      return res.status(400).json({
        success: false,
        message: "receiverId and message are required",
        data: null,
      });
    }

    if (numericReceiverId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot message yourself",
        data: null,
      });
    }

    const receiver = await userModel.getUserById(numericReceiverId);

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "Receiver not found",
        data: null,
      });
    }

    if (messageType && !allowedMessageTypes.includes(messageType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid messageType",
        data: null,
      });
    }

    const createdMessage = await postModel.createMessage(
      req.user.id,
      numericReceiverId,
      message,
      messageType,
    );

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: createdMessage,
    });
  } catch (error) {
    console.error("Create message error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send message",
      data: null,
    });
  }
}

module.exports = {
  createMessage,
};
