const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const postModel = require("../models/postModel");
const userModel = require("../models/userModel");
const { isValidMessageType } = require("../utils/messageTypes");

const USER_ROOM_PREFIX = "user:";
const PERSONAL_ROOM_PREFIX = "user_";
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
    pingInterval: 10000,
    pingTimeout: 8000,
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
      socket.userId = userId;
      socket.data.userId = userId;
      socket.data.userName = user.name || user.username || "";
      socket.data.userAvatar = user.profileImage || "";
      socket.data.activityVisible =
        user.showActivityStatus === undefined
          ? true
          : Boolean(user.showActivityStatus);
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
    const userId = socket.userId;
    const userRoom = `${USER_ROOM_PREFIX}${userId}`;
    console.log(`Socket connected userId=${userId} socket.id=${socket.id}`);
    const userSockets = onlineUsers.get(userId) || new Set();
    const becameOnline = userSockets.size === 0;
    userSockets.add(socket.id);
    onlineUsers.set(userId, userSockets);
    socket.join(userRoom);
    socket.join(`${PERSONAL_ROOM_PREFIX}${userId}`);

    socket.on("call:initiate", (payload) => {
      const targetUserId = parseUserId(payload?.targetUserId);
      if (!targetUserId || targetUserId === userId || payload?.offer == null)
        return;
      io.to(`${PERSONAL_ROOM_PREFIX}${targetUserId}`).emit("call:incoming", {
        callerId: userId,
        callerName: socket.data.userName,
        callerAvatar: socket.data.userAvatar,
        isAudioOnly: payload.isAudioOnly === true,
        offer: payload.offer,
      });
    });

    socket.on("call:accept", (payload) => {
      const callerId = parseUserId(payload?.callerId);
      if (!callerId || callerId === userId || payload?.answer == null) return;
      io.to(`${PERSONAL_ROOM_PREFIX}${callerId}`).emit("call:accepted", {
        answer: payload.answer,
      });
    });

    socket.on("call:ice_candidate", (payload) => {
      const targetUserId = parseUserId(payload?.targetUserId);
      if (
        !targetUserId ||
        targetUserId === userId ||
        payload?.candidate == null
      )
        return;
      io.to(`${PERSONAL_ROOM_PREFIX}${targetUserId}`).emit(
        "call:ice_candidate",
        { candidate: payload.candidate },
      );
    });

    socket.on("call:reject", (payload) => {
      const callerId = parseUserId(payload?.callerId);
      if (!callerId || callerId === userId) return;
      io.to(`${PERSONAL_ROOM_PREFIX}${callerId}`).emit("call:rejected");
    });

    socket.on("call:end", (payload) => {
      const targetUserId = parseUserId(payload?.targetUserId);
      if (!targetUserId || targetUserId === userId) return;
      io.to(`${PERSONAL_ROOM_PREFIX}${targetUserId}`).emit("call:ended");
    });

    socket.emit(
      "presence:snapshot",
      [...onlineUsers.keys()].filter(
        (id) => id === userId || onlineVisibility.get(id) !== false,
      ),
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
        console.log(
          `Socket joined chat userId=${userId} socket.id=${socket.id} peerId=${peerId}`,
        );
        return acknowledge({ success: true });
      } catch (error) {
        console.error(
          `Socket chat join error userId=${userId} socket.id=${socket.id}:`,
          error,
        );
        return acknowledge({
          success: false,
          message: "Could not open this conversation",
        });
      }
    });

    socket.on("presence:ping", (acknowledge = () => {}) => {
      if (typeof acknowledge === "function")
        acknowledge({ success: true, timestamp: Date.now() });
    });

    socket.on("chat:send", async (payload, acknowledge = () => {}) => {
      const receiverId = parseUserId(payload?.receiverId);
      const message =
        typeof payload?.message === "string" ? payload.message.trim() : "";
      const messageType = payload?.messageType || "text";
      const mediaUrl = payload?.mediaUrl ?? null;
      const rawReelId = payload?.reelId ?? payload?.reel_id;
      const rawPostId = payload?.postId ?? payload?.post_id;
      const reelId = rawReelId == null ? null : parseUserId(rawReelId);
      const postId = rawPostId == null ? null : parseUserId(rawPostId);
      const postImageUrl =
        payload?.postImageUrl ?? payload?.post_image_url ?? null;
      const postCaption = payload?.postCaption ?? payload?.post_caption ?? null;
      const postOwnerUsername =
        payload?.postOwnerUsername ?? payload?.post_owner_username ?? null;

      const clientMessageId =
        typeof payload?.clientMessageId === "string" &&
        payload.clientMessageId.length <= 64
          ? payload.clientMessageId
          : null;

      if (
        !receiverId ||
        receiverId === userId ||
        (!message && !mediaUrl && messageType !== "post") ||
        message.length > 5000 ||
        !clientMessageId ||
        !isValidMessageType(messageType) ||
        (["image", "video", "audio", "file"].includes(messageType) &&
          !isValidMediaUrl(mediaUrl)) ||
        (!["image", "video", "audio", "file"].includes(messageType) &&
          mediaUrl != null) ||
        (messageType === "reel" && !reelId) ||
        (messageType !== "reel" && rawReelId != null) ||
        (messageType === "post" && !postId) ||
        (messageType !== "post" && rawPostId != null)
      ) {
        console.error(
          `Socket send rejected userId=${userId} socket.id=${socket.id} receiverId=${receiverId || "invalid"}`,
        );
        return acknowledge({
          success: false,
          code: "INVALID_MESSAGE",
          message:
            "A valid receiver, message, and clientMessageId are required",
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
          postId,
          postImageUrl,
          postCaption,
          postOwnerUsername,
        );
        const event = { ...createdMessage, clientMessageId };
        attachChatSocket.emitMessage(userId, receiverId, event);
        return acknowledge({ success: true, data: event });
      } catch (error) {
        console.error(
          `Socket send message error userId=${userId} socket.id=${socket.id}:`,
          error,
        );
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
      console.log(
        `Socket disconnected userId=${userId} socket.id=${socket.id}`,
      );
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
attachChatSocket.emitMessage = (senderId, receiverId, message) => {
  const io = attachChatSocket.io;
  if (!io) return;
  io.to(`${USER_ROOM_PREFIX}${receiverId}`)
    .to(`${USER_ROOM_PREFIX}${senderId}`)
    .emit("chat:message", message);
};

module.exports = attachChatSocket;
