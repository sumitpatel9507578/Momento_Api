const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const postModel = require("../models/postModel");
const userModel = require("../models/userModel");

const USER_ROOM_PREFIX = "user:";
const onlineUsers = new Map();
const onlineVisibility = new Map();

function parseUserId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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

function attachChatSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, methods: ["GET", "POST"] },
  });
  attachChatSocket.io = io;

  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token || !process.env.JWT_SECRET) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = parseUserId(decoded.id);
      const user = userId ? await userModel.getUserById(userId) : null;
      if (!user) {
        return next(new Error("ACCOUNT_NOT_FOUND"));
      }
      socket.data.userId = userId;
      socket.data.activityVisible = user.showActivityStatus !== false;
      return next();
    } catch (error) {
      return next(
        error.message === "ACCOUNT_NOT_FOUND"
          ? error
          : new Error("Invalid or expired token"),
      );
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    const userRoom = `${USER_ROOM_PREFIX}${userId}`;
    const userSockets = onlineUsers.get(userId) || new Set();
    const becameOnline = userSockets.size === 0;
    userSockets.add(socket.id);
    onlineUsers.set(userId, userSockets);
    socket.join(userRoom);

    socket.emit(
      "presence:snapshot",
      [...onlineUsers.keys()].filter((id) => id === userId || onlineVisibility.get(id) !== false),
    );
    if (becameOnline && socket.data.activityVisible) {
      onlineVisibility.set(userId, true);
      io.emit("presence:online", { userId });
      io.emit("presence:update", { userId, isOnline: true });
    } else if (becameOnline) {
      onlineVisibility.set(userId, false);
    }

    socket.on("chat:join", async (payload, acknowledge = () => {}) => {
      const peerId = parseUserId(payload?.userId);
      if (!peerId || peerId === userId) {
        return acknowledge({ success: false, message: "Invalid chat user" });
      }
      try {
        const peer = await userModel.getUserById(peerId);
        if (!peer) {
          return acknowledge({
            success: false,
            code: "USER_NOT_FOUND",
            message: "Chat user was not found on this server",
          });
        }
        socket.join(`chat:${[userId, peerId].sort((a, b) => a - b).join(":")}`);
        return acknowledge({ success: true });
      } catch (error) {
        console.error("Socket chat join error:", error);
        return acknowledge({
          success: false,
          message: "Could not open this conversation",
        });
      }
    });

    socket.on("presence:ping", (acknowledge = () => {}) => {
      if (typeof acknowledge === "function") acknowledge({ success: true, timestamp: Date.now() });
    });

    socket.on("chat:send", async (payload, acknowledge = () => {}) => {
      const receiverId = parseUserId(payload?.receiverId);
      const message = typeof payload?.message === "string"
        ? payload.message.trim()
        : "";
      const messageType = payload?.messageType || "text";
      const mediaUrl = payload?.mediaUrl ?? null;
      const reelId = payload?.reelId == null
        ? null
        : parseUserId(payload.reelId);
      const clientMessageId =
        typeof payload?.clientMessageId === "string" &&
        payload.clientMessageId.length <= 64
          ? payload.clientMessageId
          : null;

      if (
        !receiverId ||
        receiverId === userId ||
        (!message && !mediaUrl) ||
        message.length > 5000 ||
        !clientMessageId ||
        !["text", "image", "video", "reel"].includes(messageType) ||
        (["image", "video"].includes(messageType) &&
          !isValidMediaUrl(mediaUrl)) ||
        (!["image", "video"].includes(messageType) && mediaUrl != null) ||
        (messageType === "reel" && !reelId) ||
        (messageType !== "reel" && payload?.reelId != null)
      ) {
        return acknowledge({
          success: false,
          code: "INVALID_MESSAGE",
          message: "A valid receiver, message, and clientMessageId are required",
        });
      }

      try {
        const receiver = await userModel.getUserById(receiverId);
        if (!receiver) {
          return acknowledge({
            success: false,
            code: "RECEIVER_NOT_FOUND",
            message: "Receiver not found on this server",
          });
        }

        const createdMessage = await postModel.createMessage(
          userId,
          receiverId,
          message,
          messageType,
          mediaUrl,
          reelId,
          clientMessageId,
        );
        const event = { ...createdMessage, clientMessageId };
        io.to(`${USER_ROOM_PREFIX}${receiverId}`)
          .to(userRoom)
          .emit("chat:message", event);
        return acknowledge({ success: true, data: event });
      } catch (error) {
        console.error("Socket send message error:", error);
        const migrationRequired =
          error.code === "CHAT_IDEMPOTENCY_MIGRATION_REQUIRED";
        const reelMigrationRequired =
          error.code === "REEL_MESSAGE_MIGRATION_REQUIRED";
        return acknowledge({
          success: false,
          code: error.code || "MESSAGE_SEND_FAILED",
          message: migrationRequired
            ? "Apply the chat realtime database migration before sending"
            : reelMigrationRequired
              ? "Apply the shared-reel messages migration before sharing reels"
              : "Failed to send message",
        });
      }
    });

    socket.on("chat:typing", async (payload) => {
      const receiverId = parseUserId(payload?.receiverId);
      if (!receiverId || receiverId === userId) return;
      try {
        if (!(await userModel.getUserById(receiverId))) return;
        const isTyping = payload?.isTyping === true;
        socket.data.typingTo = isTyping ? receiverId : null;
        io.to(`${USER_ROOM_PREFIX}${receiverId}`).emit("chat:typing", {
          userId,
          isTyping,
        });
      } catch (error) {
        console.error("Socket typing update error:", error);
      }
    });

    socket.on("chat:read", async (payload) => {
      const senderId = parseUserId(payload?.senderId);
      if (!senderId || senderId === userId) return;
      try {
        const updatedCount = await postModel.markMessagesRead(userId, senderId);
        if (updatedCount > 0) {
          io.to(`${USER_ROOM_PREFIX}${senderId}`).emit("chat:read", {
            readerId: userId,
            senderId,
          });
        }
      } catch (error) {
        console.error("Socket read receipt error:", error);
      }
    });

    socket.on("disconnect", () => {
      if (socket.data.typingTo) {
        io.to(`${USER_ROOM_PREFIX}${socket.data.typingTo}`).emit(
          "chat:typing",
          { userId, isTyping: false },
        );
      }
      const connectedSockets = onlineUsers.get(userId);
      if (!connectedSockets) return;
      connectedSockets.delete(socket.id);
      if (connectedSockets.size === 0) {
        onlineUsers.delete(userId);
        const wasVisible = onlineVisibility.get(userId) !== false;
        onlineVisibility.delete(userId);
        if (wasVisible) {
          io.emit("presence:offline", { userId });
          io.emit("presence:update", { userId, isOnline: false });
        }
      }
    });
  });

  return io;
}

attachChatSocket.getOnlineUserIds = () => [...onlineUsers.keys()];
attachChatSocket.setActivityVisibility = (userId, isVisible) => {
  if (!onlineUsers.has(userId)) return;
  const wasVisible = onlineVisibility.get(userId) !== false;
  onlineVisibility.set(userId, isVisible);
  if (wasVisible === isVisible) return;
  const io = attachChatSocket.io;
  if (!io) return;
  if (isVisible) {
    io.emit("presence:online", { userId });
    io.emit("presence:update", { userId, isOnline: true });
  } else {
    io.emit("presence:offline", { userId });
    io.emit("presence:update", { userId, isOnline: false });
  }
};

module.exports = attachChatSocket;
