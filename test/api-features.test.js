process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_NAME = process.env.DB_NAME || "momento_test";
process.env.JWT_SECRET = "test-only-jwt-secret";

const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, beforeEach, test } = require("node:test");
const jwt = require("jsonwebtoken");
const { io: createSocketClient } = require("socket.io-client");
const app = require("../src/app");
const db = require("../src/config/db");
const followModel = require("../src/models/followModel");
const postModel = require("../src/models/postModel");
const userModel = require("../src/models/userModel");
const attachChatSocket = require("../src/services/chatSocket");

const messageColumns = [
  "id",
  "sender_id",
  "receiver_id",
  "message",
  "message_type",
  "media_url",
  "post_id",
  "post_image_url",
  "post_caption",
  "post_owner_username",
  "is_read",
  "read_at",
  "created_at",
];
const storyColumns = [
  "id",
  "user_id",
  "media_url",
  "media_type",
  "caption",
  "expires_at",
  "created_at",
];
const likeColumns = ["id", "user_id", "post_id", "created_at"];
const repostColumns = [
  "id",
  "user_id",
  "post_id",
  "reel_id",
  "note",
  "created_at",
];
let reelLikesEnabled = false;
let reelMessagesEnabled = false;
let chatIdempotencyEnabled = false;
let storedMessages = [];
let storedLikes = [];
let storedStories = [];
let storedStoryLikes = [];
let storedReposts = [];
let savedMessages = [];
let savedReels = [];
let savedPosts = [];
let savedItemsSchemaEnabled = true;
let nextMessageId = 1;
let lastConversationQuery = "";
let nextStoryId = 1;
let nextRepostId = 1;
let nextQueryError = null;
let server;
let socketServer;
let baseUrl;

function columnRows(columns) {
  return [columns.map((Field) => ({ Field })), []];
}

async function fakeQuery(sql, params = []) {
  if (nextQueryError) {
    const error = nextQueryError;
    nextQueryError = null;
    throw error;
  }

  const normalizedSql = sql.replace(/\s+/g, " ").trim();
  if (
    !savedItemsSchemaEnabled &&
    /FROM (?:saved_messages|saved_reels|saved_posts)|INTO (?:saved_messages|saved_reels|saved_posts)/i.test(
      normalizedSql,
    )
  ) {
    throw Object.assign(new Error("table does not exist"), {
      code: "ER_NO_SUCH_TABLE",
    });
  }
  const table = normalizedSql.match(/^SHOW COLUMNS FROM (\w+)/i)?.[1];
  if (table === "messages") {
    return columnRows([
      ...messageColumns,
      ...(reelMessagesEnabled ? ["reel_id"] : []),
      ...(chatIdempotencyEnabled ? ["client_message_id"] : []),
    ]);
  }
  if (table === "likes") {
    return columnRows(
      reelLikesEnabled ? [...likeColumns, "reel_id"] : likeColumns,
    );
  }
  if (table === "stories") return columnRows(storyColumns);
  if (table === "reposts") return columnRows(repostColumns);
  if (table === "users") {
    return columnRows(["id", "username", "full_name", "profile_image"]);
  }
  if (
    table === "saved_messages" ||
    table === "saved_reels" ||
    table === "saved_posts"
  ) {
    if (!savedItemsSchemaEnabled) {
      throw Object.assign(new Error("table does not exist"), {
        code: "ER_NO_SUCH_TABLE",
      });
    }
    return columnRows(
      table === "saved_messages"
        ? ["user_id", "message_id", "saved_at"]
        : table === "saved_reels"
          ? ["user_id", "reel_id", "saved_at"]
          : ["user_id", "post_id", "saved_at"],
    );
  }

  if (normalizedSql.startsWith("SELECT * FROM users WHERE id = ?")) {
    const id = Number(params[0]);
    return [
      id === 404
        ? []
        : [
            {
              id,
              username: `user-${id}`,
              full_name: `User ${id}`,
              profile_image: null,
            },
          ],
      [],
    ];
  }

  if (normalizedSql.startsWith("SELECT * FROM reposts WHERE id = ?")) {
    const repost = storedReposts.find((item) => item.id === Number(params[0]));
    return [repost ? [{ ...repost }] : [], []];
  }

  if (normalizedSql.startsWith("SELECT * FROM reposts WHERE user_id = ? AND")) {
    const isReel = normalizedSql.includes("reel_id = ?");
    const repost = storedReposts.find(
      (item) =>
        item.user_id === Number(params[0]) &&
        (isReel
          ? item.reel_id === Number(params[1])
          : item.post_id === Number(params[1])),
    );
    return [repost ? [{ ...repost }] : [], []];
  }

  if (
    normalizedSql.startsWith("SELECT * FROM reposts WHERE user_id = ? ORDER BY")
  ) {
    const rows = storedReposts
      .filter((item) => item.user_id === Number(params[0]))
      .sort((left, right) => right.id - left.id)
      .map((item) => ({ ...item }));
    return [rows, []];
  }

  if (normalizedSql.startsWith("INSERT INTO reposts")) {
    const [userId, postId, reelId, note] = params;
    if (
      storedReposts.some(
        (item) =>
          item.user_id === userId &&
          ((postId != null && item.post_id === postId) ||
            (reelId != null && item.reel_id === reelId)),
      )
    ) {
      throw Object.assign(new Error("duplicate repost"), {
        code: "ER_DUP_ENTRY",
      });
    }
    const id = nextRepostId++;
    storedReposts.push({
      id,
      user_id: userId,
      post_id: postId,
      reel_id: reelId,
      note,
      created_at: new Date(`2026-10-12T00:00:${String(id).padStart(2, "0")}Z`),
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (
    normalizedSql.startsWith("DELETE FROM reposts WHERE id = ? AND user_id = ?")
  ) {
    const [repostId, userId] = params.map(Number);
    const originalLength = storedReposts.length;
    storedReposts = storedReposts.filter(
      (item) => item.id !== repostId || item.user_id !== userId,
    );
    return [{ affectedRows: originalLength - storedReposts.length }, []];
  }

  if (
    normalizedSql.startsWith(
      "SELECT (SELECT COUNT(*) FROM posts WHERE user_id = ?)",
    )
  ) {
    return [
      [
        {
          postsCount: 0,
          reelsCount: 0,
          followersCount: 0,
          followingCount: 0,
        },
      ],
      [],
    ];
  }

  if (normalizedSql.startsWith("SELECT post_id FROM saved_posts")) {
    const existing = savedPosts.find(
      (bookmark) =>
        bookmark.user_id === Number(params[0]) &&
        bookmark.post_id === Number(params[1]),
    );
    return [existing ? [{ post_id: existing.post_id }] : [], []];
  }

  if (normalizedSql.startsWith("INSERT INTO saved_posts")) {
    const [userId, postId] = params.map(Number);
    if (
      savedPosts.some(
        (bookmark) =>
          bookmark.user_id === userId && bookmark.post_id === postId,
      )
    ) {
      throw Object.assign(new Error("duplicate saved post"), {
        code: "ER_DUP_ENTRY",
      });
    }
    savedPosts.push({ user_id: userId, post_id: postId, saved_at: new Date() });
    return [{ affectedRows: 1 }, []];
  }

  if (normalizedSql.startsWith("DELETE FROM saved_posts")) {
    const [userId, postId] = params.map(Number);
    const originalLength = savedPosts.length;
    savedPosts = savedPosts.filter(
      (bookmark) => bookmark.user_id !== userId || bookmark.post_id !== postId,
    );
    return [{ affectedRows: originalLength - savedPosts.length }, []];
  }

  const targetMatch = normalizedSql.match(
    /^SELECT id FROM (posts|reels) WHERE id = \?/,
  );
  if (targetMatch) {
    const id = Number(params[0]);
    return [id === 404 ? [] : [{ id }], []];
  }

  if (normalizedSql.startsWith("SELECT r.*, u.username")) {
    const id = Number(params[0]);
    return [
      id === 404
        ? []
        : [
            {
              id,
              user_id: 11,
              video_url: `https://cdn.example/reels/${id}.mp4`,
              caption: `Reel ${id}`,
              song_name: null,
              username: "reel-owner",
              name: "Reel Owner",
              profile_image: null,
            },
          ],
      [],
    ];
  }

  if (
    normalizedSql.startsWith("SELECT id, sender_id, receiver_id FROM messages")
  ) {
    const record = storedMessages.find(
      (message) => message.id === Number(params[0]),
    );
    return [
      record
        ? [
            {
              id: record.id,
              sender_id: record.sender_id,
              receiver_id: record.receiver_id,
            },
          ]
        : [],
      [],
    ];
  }

  if (
    normalizedSql.startsWith(
      "SELECT id FROM messages WHERE sender_id = ? AND client_message_id = ?",
    )
  ) {
    const existing = storedMessages.find(
      (message) =>
        message.sender_id === Number(params[0]) &&
        message.client_message_id === params[1],
    );
    return [existing ? [{ id: existing.id }] : [], []];
  }

  if (normalizedSql.startsWith("SELECT message_id FROM saved_messages")) {
    const existing = savedMessages.find(
      (bookmark) =>
        bookmark.user_id === Number(params[0]) &&
        bookmark.message_id === Number(params[1]),
    );
    return [existing ? [{ message_id: existing.message_id }] : [], []];
  }

  if (normalizedSql.startsWith("INSERT INTO saved_messages")) {
    const [userId, messageId] = params.map(Number);
    if (
      savedMessages.some(
        (bookmark) =>
          bookmark.user_id === userId && bookmark.message_id === messageId,
      )
    ) {
      throw Object.assign(new Error("duplicate saved message"), {
        code: "ER_DUP_ENTRY",
      });
    }
    savedMessages.push({
      user_id: userId,
      message_id: messageId,
      saved_at: new Date(),
    });
    return [{ affectedRows: 1 }, []];
  }

  if (normalizedSql.startsWith("DELETE FROM saved_messages")) {
    const [userId, messageId] = params.map(Number);
    const originalLength = savedMessages.length;
    savedMessages = savedMessages.filter(
      (bookmark) =>
        bookmark.user_id !== userId || bookmark.message_id !== messageId,
    );
    return [{ affectedRows: originalLength - savedMessages.length }, []];
  }

  if (normalizedSql.startsWith("SELECT reel_id FROM saved_reels")) {
    const existing = savedReels.find(
      (bookmark) =>
        bookmark.user_id === Number(params[0]) &&
        bookmark.reel_id === Number(params[1]),
    );
    return [existing ? [{ reel_id: existing.reel_id }] : [], []];
  }

  if (normalizedSql.startsWith("INSERT INTO saved_reels")) {
    const [userId, reelId] = params.map(Number);
    if (
      savedReels.some(
        (bookmark) =>
          bookmark.user_id === userId && bookmark.reel_id === reelId,
      )
    ) {
      throw Object.assign(new Error("duplicate saved reel"), {
        code: "ER_DUP_ENTRY",
      });
    }
    savedReels.push({ user_id: userId, reel_id: reelId, saved_at: new Date() });
    return [{ affectedRows: 1 }, []];
  }

  if (normalizedSql.startsWith("DELETE FROM saved_reels")) {
    const [userId, reelId] = params.map(Number);
    const originalLength = savedReels.length;
    savedReels = savedReels.filter(
      (bookmark) => bookmark.user_id !== userId || bookmark.reel_id !== reelId,
    );
    return [{ affectedRows: originalLength - savedReels.length }, []];
  }

  if (
    normalizedSql.startsWith("SELECT m.id AS itemId, sm.saved_at AS savedAt")
  ) {
    const userId = Number(params[2]);
    return [
      savedMessages
        .filter((bookmark) => bookmark.user_id === userId)
        .map((bookmark) => {
          const message = storedMessages.find(
            (entry) => entry.id === bookmark.message_id,
          );
          const conversationUserId =
            message.sender_id === userId
              ? message.receiver_id
              : message.sender_id;
          return {
            itemId: message.id,
            savedAt: bookmark.saved_at,
            senderId: message.sender_id,
            receiverId: message.receiver_id,
            message: message.message,
            messageType: message.message_type,
            mediaUrl: message.media_url,
            createdAt: message.created_at,
            reelId: message.reel_id,
            reelVideoUrl: message.reel_id
              ? `https://cdn.example/reels/${message.reel_id}.mp4`
              : null,
            reelCaption: message.reel_id ? `Reel ${message.reel_id}` : null,
            reelOwnerId: message.reel_id ? 11 : null,
            reelOwnerUsername: message.reel_id ? "reel-owner" : null,
            conversationUserId,
            conversationUsername: `user-${conversationUserId}`,
            conversationName: `User ${conversationUserId}`,
            conversationProfileImage: null,
          };
        }),
      [],
    ];
  }

  if (
    normalizedSql.startsWith("SELECT p.id AS itemId, sp.saved_at AS savedAt")
  ) {
    return [
      savedPosts
        .filter((bookmark) => bookmark.user_id === Number(params[0]))
        .map((bookmark) => ({
          itemType: "post",
          itemId: bookmark.post_id,
          savedAt: bookmark.saved_at,
          userId: 11,
          username: "post-owner",
          name: "Post Owner",
          profileImage: null,
          mediaUrl: `https://cdn.example/posts/${bookmark.post_id}.jpg`,
          mediaType: "image",
          caption: `Post ${bookmark.post_id}`,
          likesCount: 0,
          commentsCount: 0,
        })),
      [],
    ];
  }

  if (
    normalizedSql.startsWith("SELECT r.id AS itemId, sr.saved_at AS savedAt")
  ) {
    const userId = Number(params[0]);
    return [
      savedReels
        .filter((bookmark) => bookmark.user_id === userId)
        .map((bookmark) => ({
          itemId: bookmark.reel_id,
          savedAt: bookmark.saved_at,
          reelOwnerId: 11,
          videoUrl: `https://cdn.example/reels/${bookmark.reel_id}.mp4`,
          caption: `Reel ${bookmark.reel_id}`,
          songName: null,
          reelOwnerUsername: "reel-owner",
          reelOwnerName: "Reel Owner",
          reelOwnerProfileImage: null,
        })),
      [],
    ];
  }

  if (normalizedSql.startsWith("SELECT id FROM likes WHERE user_id = ?")) {
    const isReel = normalizedSql.includes("reel_id");
    const targetId = Number(params[1]);
    const existing = storedLikes.find(
      (like) =>
        like.user_id === Number(params[0]) &&
        (isReel ? like.reel_id === targetId : like.post_id === targetId),
    );
    return [existing ? [{ id: existing.id }] : [], []];
  }

  if (/^SELECT user_id FROM (posts|reels) WHERE id = \?/i.test(normalizedSql)) {
    return [[{ user_id: 11 }], []];
  }

  if (normalizedSql.startsWith("INSERT INTO notifications")) {
    return [{ insertId: 1, affectedRows: 1 }, []];
  }

  if (normalizedSql.startsWith("INSERT INTO likes")) {
    const isReel = normalizedSql.includes("reel_id");
    storedLikes.push({
      id: storedLikes.length + 1,
      user_id: Number(params[0]),
      post_id: isReel ? null : Number(params[1]),
      reel_id: isReel ? Number(params[1]) : null,
    });
    return [{ insertId: storedLikes.length }, []];
  }

  if (normalizedSql.startsWith("DELETE FROM likes WHERE user_id = ?")) {
    const isReel = normalizedSql.includes("reel_id");
    const targetId = Number(params[1]);
    storedLikes = storedLikes.filter(
      (like) =>
        !(
          like.user_id === Number(params[0]) &&
          (isReel ? like.reel_id === targetId : like.post_id === targetId)
        ),
    );
    return [{ affectedRows: 1 }, []];
  }

  if (normalizedSql.startsWith("INSERT INTO messages")) {
    const columnList = normalizedSql.match(
      /INSERT INTO messages \((.*?)\)/,
    )?.[1];
    const insertedValues = Object.fromEntries(
      columnList.split(", ").map((column, index) => [column, params[index]]),
    );
    const {
      sender_id: senderId,
      receiver_id: receiverId,
      message,
      message_type: messageType,
      media_url: mediaUrl,
    } = insertedValues;
    const reelId = insertedValues.reel_id ?? null;
    const clientMessageId = insertedValues.client_message_id ?? null;
    if (
      clientMessageId &&
      storedMessages.some(
        (item) =>
          item.sender_id === senderId &&
          item.client_message_id === clientMessageId,
      )
    ) {
      throw Object.assign(new Error("duplicate client message ID"), {
        code: "ER_DUP_ENTRY",
      });
    }
    const record = {
      id: nextMessageId++,
      sender_id: senderId,
      receiver_id: receiverId,
      message,
      message_type: messageType,
      media_url: mediaUrl,
      post_id: insertedValues.post_id ?? null,
      post_image_url: insertedValues.post_image_url ?? null,
      post_caption: insertedValues.post_caption ?? null,
      post_owner_username: insertedValues.post_owner_username ?? null,
      reel_id: reelMessagesEnabled ? (reelId ?? null) : null,
      client_message_id: clientMessageId,
      is_read: 0,
      created_at: new Date(`2026-10-12T00:00:0${nextMessageId}Z`),
    };
    storedMessages.push(record);
    return [{ insertId: record.id }, []];
  }

  if (
    normalizedSql.startsWith("SELECT m.id, m.sender_id AS senderId") &&
    normalizedSql.includes("WHERE m.id = ?")
  ) {
    const message = storedMessages.find(
      (record) => record.id === Number(params[0]),
    );
    return [
      message
        ? [
            {
              id: message.id,
              senderId: message.sender_id,
              receiverId: message.receiver_id,
              message: message.message,
              messageType: message.message_type,
              mediaUrl: message.media_url,
              postId: message.post_id,
              postImageUrl: message.post_image_url,
              postCaption: message.post_caption,
              postOwnerUsername: message.post_owner_username,
              reelId: message.reel_id,
              reelVideoUrl: message.reel_id
                ? `https://cdn.example/reels/${message.reel_id}.mp4`
                : null,
              reelCaption: message.reel_id ? `Reel ${message.reel_id}` : null,
              reelOwnerId: message.reel_id ? 11 : null,
              reelOwnerUsername: message.reel_id ? "reel-owner" : null,
              clientMessageId: message.client_message_id,
              isRead: message.is_read,
              createdAt: message.created_at,
            },
          ]
        : [],
      [],
    ];
  }

  if (
    normalizedSql.startsWith("SELECT m.id, m.sender_id AS senderId") &&
    normalizedSql.includes("WHERE ((m.sender_id = ? AND m.receiver_id = ?")
  ) {
    const [userId, otherUserId] = params;
    let rows = storedMessages
      .filter(
        (message) =>
          (message.sender_id === userId &&
            message.receiver_id === otherUserId) ||
          (message.sender_id === otherUserId && message.receiver_id === userId),
      )
      .sort((left, right) =>
        normalizedSql.includes("ORDER BY m.id DESC")
          ? right.id - left.id
          : left.created_at - right.created_at || left.id - right.id,
      );
    if (normalizedSql.includes("AND m.id < ?")) {
      rows = rows.filter((message) => message.id < Number(params[4]));
    }
    if (normalizedSql.includes("LIMIT ?")) {
      rows = rows.slice(0, Number(params.at(-1)));
    }
    rows = rows.map((message) => ({
      id: message.id,
      senderId: message.sender_id,
      receiverId: message.receiver_id,
      message: message.message,
      messageType: message.message_type,
      mediaUrl: message.media_url,
      postId: message.post_id,
      postImageUrl: message.post_image_url,
      postCaption: message.post_caption,
      postOwnerUsername: message.post_owner_username,
      reelId: message.reel_id,
      reelVideoUrl: message.reel_id
        ? `https://cdn.example/reels/${message.reel_id}.mp4`
        : null,
      reelCaption: message.reel_id ? `Reel ${message.reel_id}` : null,
      reelOwnerId: message.reel_id ? 11 : null,
      reelOwnerUsername: message.reel_id ? "reel-owner" : null,
      isRead: message.is_read,
      createdAt: message.created_at,
    }));
    return [rows, []];
  }

  if (normalizedSql.startsWith("SELECT m.id, m.sender_id AS senderId")) {
    lastConversationQuery = normalizedSql;
    const userId = Number(params[0]);
    const latestByParticipant = new Map();
    for (const message of storedMessages) {
      if (message.sender_id !== userId && message.receiver_id !== userId)
        continue;
      const conversationUserId =
        message.sender_id === userId ? message.receiver_id : message.sender_id;
      const previous = latestByParticipant.get(conversationUserId);
      if (!previous || message.created_at > previous.created_at) {
        latestByParticipant.set(conversationUserId, message);
      }
    }
    return [
      [...latestByParticipant.entries()].map(
        ([conversationUserId, message]) => ({
          id: message.id,
          senderId: message.sender_id,
          receiverId: message.receiver_id,
          message: message.message,
          messageType: message.message_type,
          mediaUrl: message.media_url,
          isRead: message.is_read,
          createdAt: message.created_at,
          conversationUserId,
          username: `user-${conversationUserId}`,
          name: `User ${conversationUserId}`,
          profileImage: "",
        }),
      ),
      [],
    ];
  }

  if (normalizedSql.startsWith("INSERT INTO stories")) {
    const [userId, mediaUrl, mediaType, caption, expiresAt] = params;
    const id = nextStoryId++;
    storedStories.push({ id, userId, mediaUrl, mediaType, caption, expiresAt });
    return [{ insertId: id }, []];
  }

  if (
    normalizedSql.startsWith(
      "SELECT s.user_id AS ownerId, sl.user_id AS likedByUser",
    )
  ) {
    const [userId, storyId] = params.map(Number);
    const story = storedStories.find((item) => item.id === storyId);
    if (!story || new Date(story.expiresAt).getTime() <= Date.now()) {
      return [[], []];
    }
    const liked = storedStoryLikes.some(
      (like) => like.story_id === storyId && like.user_id === userId,
    );
    return [
      [{ ownerId: story.userId, likedByUser: liked ? userId : null }],
      [],
    ];
  }

  if (normalizedSql.startsWith("INSERT INTO story_likes")) {
    const [storyId, userId] = params.map(Number);
    storedStoryLikes.push({ story_id: storyId, user_id: userId });
    return [{ affectedRows: 1 }, []];
  }

  if (normalizedSql.startsWith("DELETE FROM story_likes")) {
    const [storyId, userId] = params.map(Number);
    const previousLength = storedStoryLikes.length;
    storedStoryLikes = storedStoryLikes.filter(
      (like) => like.story_id !== storyId || like.user_id !== userId,
    );
    return [{ affectedRows: previousLength - storedStoryLikes.length }, []];
  }

  if (normalizedSql.startsWith("SELECT s.*, u.username")) {
    assert.match(normalizedSql, /s\.expires_at > NOW\(\)/);
    const now = Date.now();
    return [
      storedStories
        .filter((story) => new Date(story.expiresAt).getTime() > now)
        .map((story) => ({
          id: story.id,
          user_id: story.userId,
          media_url: story.mediaUrl,
          media_type: story.mediaType,
          expires_at: story.expiresAt,
          profile_image: "",
          username: `user-${story.userId}`,
        })),
      [],
    ];
  }

  throw new Error(`Unexpected SQL in test: ${normalizedSql}`);
}

async function request(path, options = {}) {
  const { authUserId = 7, authToken, ...requestOptions } = options;
  return fetch(`${baseUrl}${path}`, {
    ...requestOptions,
    headers: {
      ...(requestOptions.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(requestOptions.headers || {}),
      Authorization:
        authToken ||
        `Bearer ${jwt.sign({ id: authUserId }, process.env.JWT_SECRET)}`,
    },
  });
}

before(async () => {
  db.query = fakeQuery;
  userModel.getUserById = async (id) =>
    Number(id) === 404 ? null : { id: Number(id), username: `user-${id}` };
  server = http.createServer(app);
  socketServer = attachChatSocket(server);
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  reelLikesEnabled = false;
  reelMessagesEnabled = false;
  chatIdempotencyEnabled = false;
  storedMessages = [];
  storedLikes = [];
  storedStories = [];
  storedStoryLikes = [];
  storedReposts = [];
  savedMessages = [];
  savedReels = [];
  savedPosts = [];
  savedItemsSchemaEnabled = true;
  nextMessageId = 1;
  lastConversationQuery = "";
  nextStoryId = 1;
  nextRepostId = 1;
  nextQueryError = null;
});

after(async () => {
  await new Promise((resolve) => socketServer.close(resolve));
  await db.end();
});

test("chat sockets authenticate, persist, deliver, report typing, and acknowledge reads", async (t) => {
  const originalCreateMessage = postModel.createMessage;
  const originalMarkMessagesRead = postModel.markMessagesRead;
  const socketMessages = [];
  const createMessageCalls = [];
  let readReceipt;
  t.after(() => {
    postModel.createMessage = originalCreateMessage;
    postModel.markMessagesRead = originalMarkMessagesRead;
  });

  postModel.createMessage = async (
    senderId,
    receiverId,
    message,
    messageType,
    mediaUrl,
    reelId,
    clientMessageId,
    ...remainingArgs
  ) => {
    createMessageCalls.push([
      senderId,
      receiverId,
      message,
      messageType,
      mediaUrl,
      reelId,
      clientMessageId,
      ...remainingArgs,
    ]);
    const existing = socketMessages.find(
      (item) =>
        item.senderId === senderId && item.clientMessageId === clientMessageId,
    );
    if (existing) return existing;
    const created = {
      id: String(socketMessages.length + 1),
      senderId,
      receiverId,
      message,
      messageType,
      mediaUrl,
      reelId,
      clientMessageId,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    socketMessages.push(created);
    return created;
  };
  postModel.markMessagesRead = async () => 1;

  const connect = (userId) =>
    new Promise((resolve, reject) => {
      const client = createSocketClient(baseUrl, {
        transports: ["websocket"],
        auth: { token: jwt.sign({ id: userId }, process.env.JWT_SECRET) },
        reconnection: false,
      });
      client.once("connect", () => resolve(client));
      client.once("connect_error", reject);
    });
  const sender = await connect(7);
  const receiver = await connect(8);
  t.after(() => {
    sender.disconnect();
    receiver.disconnect();
  });

  const typing = new Promise((resolve) =>
    receiver.once("chat:typing", resolve),
  );
  sender.emit("chat:typing", { receiverId: 8, isTyping: true });
  assert.deepEqual(await typing, { userId: 7, isTyping: true });

  const delivered = new Promise((resolve) =>
    receiver.once("chat:message", resolve),
  );
  const firstAck = await new Promise((resolve) => {
    sender.emit(
      "chat:send",
      {
        receiverId: 8,
        message: "hello in realtime",
        messageType: "text",
        clientMessageId: "stable-client-id",
      },
      resolve,
    );
  });
  assert.equal(firstAck.success, true);
  assert.equal(firstAck.data.id, "1");
  assert.equal((await delivered).message, "hello in realtime");

  const duplicateAck = await new Promise((resolve) => {
    sender.emit(
      "chat:send",
      {
        receiverId: 8,
        message: "hello in realtime",
        messageType: "text",
        clientMessageId: "stable-client-id",
      },
      resolve,
    );
  });
  assert.equal(duplicateAck.data.id, "1");
  assert.equal(socketMessages.length, 1);

  const restDelivered = new Promise((resolve) =>
    receiver.once("chat:message", resolve),
  );
  const restSent = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      receiverId: 8,
      message: "sent over REST",
      messageType: "text",
    }),
  });
  assert.equal(restSent.status, 201);
  assert.equal((await restDelivered).message, "sent over REST");
  assert.equal(createMessageCalls[0].length, 11);
  assert.equal(createMessageCalls[2].length, 11);

  const imageDelivered = new Promise((resolve) =>
    receiver.once("chat:message", resolve),
  );
  const imageAck = await new Promise((resolve) => {
    sender.emit(
      "chat:send",
      {
        receiverId: 8,
        message: "",
        messageType: "image",
        mediaUrl: "https://cdn.example/chat/photo.jpg",
        clientMessageId: "image-client-id",
      },
      resolve,
    );
  });
  assert.equal(imageAck.success, true);
  assert.equal(
    (await imageDelivered).mediaUrl,
    "https://cdn.example/chat/photo.jpg",
  );

  const invalidImageAck = await new Promise((resolve) => {
    sender.emit(
      "chat:send",
      {
        receiverId: 8,
        message: "",
        messageType: "image",
        mediaUrl: "javascript:alert(1)",
        clientMessageId: "invalid-image-client-id",
      },
      resolve,
    );
  });
  assert.equal(invalidImageAck.code, "INVALID_MESSAGE");

  const receipt = new Promise((resolve) => sender.once("chat:read", resolve));
  receiver.emit("chat:read", { senderId: 7 });
  readReceipt = await receipt;
  assert.deepEqual(readReceipt, { readerId: 8, senderId: 7 });

  const invalidUser = createSocketClient(baseUrl, {
    transports: ["websocket"],
    auth: { token: jwt.sign({ id: 404 }, process.env.JWT_SECRET) },
    reconnection: false,
  });
  const connectError = await new Promise((resolve) =>
    invalidUser.once("connect_error", resolve),
  );
  assert.equal(connectError.message, "ACCOUNT_NOT_FOUND");
  invalidUser.disconnect();
});

test("chat retries reuse a client ID and require the idempotency migration", async () => {
  await assert.rejects(
    postModel.createMessage(7, 8, "queued once", "text", null, null, "retry-1"),
    { code: "CHAT_IDEMPOTENCY_MIGRATION_REQUIRED" },
  );

  chatIdempotencyEnabled = true;
  const first = await postModel.createMessage(
    7,
    8,
    "queued once",
    "text",
    null,
    null,
    "retry-1",
  );
  const retry = await postModel.createMessage(
    7,
    8,
    "queued once",
    "text",
    null,
    null,
    "retry-1",
  );

  assert.equal(first.id, retry.id);
  assert.equal(first.clientMessageId, "retry-1");
  assert.equal(storedMessages.length, 1);
});

test("messages use the authenticated sender and return chronological and empty conversations", async () => {
  const sent = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      senderId: 999,
      receiverId: 8,
      message: "hello",
      messageType: "text",
    }),
  });
  assert.equal(sent.status, 201);
  const sentJson = await sent.json();
  assert.equal(sentJson.data.senderId, 7);
  assert.equal(storedMessages[0].sender_id, 7);
  assert.equal(storedMessages[0].receiver_id, 8);

  const secondSent = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      receiverId: 8,
      message: "follow-up",
      messageType: "text",
    }),
  });
  assert.equal(secondSent.status, 201);

  const fetched = await request("/api/messages/8");
  assert.equal(fetched.status, 200);
  assert.deepEqual(
    (await fetched.json()).data.map((message) => message.message),
    ["hello", "follow-up"],
  );

  const newestPage = await request("/api/messages/8?limit=1");
  const newestPageJson = await newestPage.json();
  assert.equal(newestPageJson.data[0].message, "follow-up");
  assert.equal(newestPageJson.hasMore, true);
  const olderPage = await request("/api/messages/8?beforeId=2&limit=1");
  const olderPageJson = await olderPage.json();
  assert.equal(olderPageJson.data[0].message, "hello");
  assert.equal(olderPageJson.hasMore, false);

  const conversations = await request("/api/messages/conversations");
  assert.equal(conversations.status, 200);
  const conversationData = (await conversations.json()).data;
  assert.equal(conversationData.length, 1);
  assert.equal(conversationData[0].conversationUserId, 8);
  assert.match(lastConversationQuery, /NOT EXISTS/);

  assert.equal((await request("/api/messages/9")).status, 200);
  const empty = await request("/api/messages/9");
  assert.deepEqual((await empty.json()).data, []);
});

test("REST supports shared post messages and persists the post preview fields", async () => {
  const response = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      receiverId: 8,
      messageType: "post",
      postId: 12,
      postImageUrl: "https://cdn.example/posts/12.jpg",
      postCaption: "A caption",
      postOwnerUsername: "post-owner",
    }),
  });

  assert.equal(response.status, 201);
  const sent = await response.json();
  assert.equal(sent.data.messageType, "post");
  assert.equal(sent.data.postId, 12);
  assert.equal(sent.data.postImageUrl, "https://cdn.example/posts/12.jpg");
  assert.equal(sent.data.postCaption, "A caption");
  assert.equal(sent.data.postOwnerUsername, "post-owner");
});

test("messages reject invalid receivers, unsupported types, and unauthenticated requests", async () => {
  const invalid = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({ receiverId: "nope", message: "hello" }),
  });
  assert.equal(invalid.status, 400);

  const missingReceiver = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({ receiverId: 404, message: "hello" }),
  });
  assert.equal(missingReceiver.status, 404);

  const invalidType = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      receiverId: 8,
      message: "hello",
      messageType: "sticker",
    }),
  });
  assert.equal(invalidType.status, 400);

  const unauthenticated = await fetch(`${baseUrl}/api/messages/8`);
  assert.equal(unauthenticated.status, 401);
});

test("shared reel messages persist the canonical reel ID and require its schema migration", async () => {
  const payload = {
    receiverId: 8,
    message: "Shared a reel",
    messageType: "reel",
    reelId: 9,
  };
  const migrationRequired = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(migrationRequired.status, 503);
  assert.equal(storedMessages.length, 0);

  reelMessagesEnabled = true;
  const sent = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(sent.status, 201);
  assert.equal(storedMessages[0].message, "Shared a reel");
  assert.equal(storedMessages[0].reel_id, 9);
  assert.equal(storedLikes.length, 0);

  const fetched = await request("/api/messages/8");
  assert.equal(fetched.status, 200);
  const sharedMessage = (await fetched.json()).data[0];
  assert.equal(sharedMessage.reelId, 9);
  assert.equal(sharedMessage.reelVideoUrl, "https://cdn.example/reels/9.mp4");
  assert.equal(sharedMessage.reelOwnerUsername, "reel-owner");

  const invalidReel = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({ ...payload, reelId: 404 }),
  });
  assert.equal(invalidReel.status, 404);
});

test("saved posts, messages, and reels persist per user without mutating content", async () => {
  const sent = await request("/api/messages", {
    method: "POST",
    body: JSON.stringify({ receiverId: 8, message: "bookmark me" }),
  });
  const message = (await sent.json()).data;
  const originalMessage = { ...storedMessages[0] };

  const saveMessage = () =>
    request(`/api/saved-items/messages/${message.id}`, { method: "POST" });
  const firstSave = await saveMessage();
  assert.equal(firstSave.status, 200);
  assert.deepEqual((await firstSave.json()).data, {
    itemType: "message",
    itemId: message.id,
    saved: true,
    alreadySaved: false,
  });

  const duplicateSave = await saveMessage();
  assert.equal((await duplicateSave.json()).data.alreadySaved, true);
  assert.equal(savedMessages.length, 1);

  const receiverSave = await request(
    `/api/saved-items/messages/${message.id}`,
    { method: "POST", authUserId: 8 },
  );
  assert.equal(receiverSave.status, 200);
  const unrelatedSave = await request(
    `/api/saved-items/messages/${message.id}`,
    { method: "POST", authUserId: 9 },
  );
  assert.equal(unrelatedSave.status, 403);

  const unauthorizedUnsave = await request(
    `/api/saved-items/messages/${message.id}`,
    { method: "DELETE", authUserId: 8 },
  );
  assert.equal(unauthorizedUnsave.status, 200);
  assert.equal(
    savedMessages.some((bookmark) => bookmark.user_id === 7),
    true,
  );

  const saveReel = await request("/api/saved-items/reels/9", {
    method: "POST",
  });
  assert.equal(saveReel.status, 200);
  const duplicateReelSave = await request("/api/saved-items/reels/9", {
    method: "POST",
  });
  assert.equal((await duplicateReelSave.json()).data.alreadySaved, true);
  assert.equal(savedReels.length, 1);

  const savePost = await request("/api/saved-items/posts/12", {
    method: "POST",
  });
  assert.equal(savePost.status, 200);
  assert.deepEqual((await savePost.json()).data, {
    itemType: "post",
    itemId: 12,
    saved: true,
    alreadySaved: false,
  });
  const duplicatePostSave = await request("/api/saved-items/posts/12", {
    method: "POST",
  });
  assert.equal((await duplicatePostSave.json()).data.alreadySaved, true);
  assert.equal(savedPosts.length, 1);
  const missingPost = await request("/api/saved-items/posts/404", {
    method: "POST",
  });
  assert.equal(missingPost.status, 404);

  const separateUserSave = await request("/api/saved-items/posts/12", {
    method: "POST",
    authUserId: 8,
  });
  assert.equal(separateUserSave.status, 200);
  assert.equal(savedPosts.length, 2);
  assert.equal(storedLikes.length, 0);

  const savedItemsResponse = await request("/api/saved-items");
  assert.equal(savedItemsResponse.status, 200);
  const items = (await savedItemsResponse.json()).data;
  assert.deepEqual(items.map((item) => item.itemType).sort(), [
    "message",
    "post",
    "reel",
  ]);
  assert.equal(
    items.find((item) => item.itemType === "post").mediaUrl,
    "https://cdn.example/posts/12.jpg",
  );
  assert.equal(
    items.find((item) => item.itemType === "reel").videoUrl,
    "https://cdn.example/reels/9.mp4",
  );
  assert.equal(
    items.find((item) => item.itemType === "message").message,
    "bookmark me",
  );
  assert.deepEqual(storedMessages[0], originalMessage);

  assert.equal(
    (
      await request(`/api/saved-items/messages/${message.id}`, {
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/saved-items/reels/9", { method: "DELETE" })).status,
    200,
  );
  assert.equal(
    (await request("/api/saved-items/posts/12", { method: "DELETE" })).status,
    200,
  );
  assert.equal(
    savedPosts.some((bookmark) => bookmark.user_id === 7),
    false,
  );
  assert.deepEqual((await (await request("/api/saved-items")).json()).data, []);
  assert.equal(savedMessages.length, 0);
  assert.equal(savedReels.length, 0);
});

test("saved items report unavailable migration and enforce authentication", async () => {
  savedItemsSchemaEnabled = false;
  const missingMigration = await request("/api/saved-items");
  assert.equal(missingMigration.status, 503);
  assert.equal((await missingMigration.json()).success, false);

  const expiredToken = jwt.sign({ id: 7 }, process.env.JWT_SECRET, {
    expiresIn: -1,
  });
  const expiredAuth = await request("/api/saved-items", {
    authToken: `Bearer ${expiredToken}`,
  });
  assert.equal(expiredAuth.status, 401);

  savedItemsSchemaEnabled = true;
  const invalidId = await request("/api/saved-items/reels/invalid", {
    method: "POST",
  });
  assert.equal(invalidId.status, 400);
});

test("reel deletion is authenticated and limited to the reel owner", async (t) => {
  const originalDeleteReel = postModel.deleteReel;
  const deletedBy = [];
  t.after(() => {
    postModel.deleteReel = originalDeleteReel;
  });

  postModel.deleteReel = async (reelId, userId) => {
    deletedBy.push({ reelId, userId });
    return reelId === "9" && userId === 7;
  };

  const deleted = await request("/api/reels/9", { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).success, true);
  assert.deepEqual(deletedBy, [{ reelId: "9", userId: 7 }]);

  const notOwner = await request("/api/reels/9", {
    method: "DELETE",
    authUserId: 8,
  });
  assert.equal(notOwner.status, 404);

  const invalidId = await request("/api/reels/not-an-id", {
    method: "DELETE",
  });
  assert.equal(invalidId.status, 400);

  const unauthenticated = await fetch(`${baseUrl}/api/reels/9`, {
    method: "DELETE",
  });
  assert.equal(unauthenticated.status, 401);
});

test("reel-like aliases use reel_id, toggle state, and never create post likes", async () => {
  reelLikesEnabled = true;
  const aliases = [
    "/api/likes/reel/40",
    "/api/likes/reels/40",
    "/api/reels/40/like",
    "/api/reels/like/40",
  ];
  for (const path of aliases) {
    const liked = await request(path, { method: "POST" });
    assert.equal(liked.status, 201);
    assert.equal((await liked.json()).isLiked, true);
    assert.equal(storedLikes.at(-1).reel_id, 40);
    assert.equal(storedLikes.at(-1).post_id, null);

    const unliked = await request(path, { method: "POST" });
    assert.equal(unliked.status, 200);
    assert.equal((await unliked.json()).isLiked, false);
  }

  const postLike = await request("/api/likes/post/25", { method: "POST" });
  assert.equal(postLike.status, 201);
  assert.equal(storedLikes.at(-1).post_id, 25);
  assert.equal(storedLikes.at(-1).reel_id, null);
});

test("story likes toggle only for active stories", async () => {
  storedStories.push({
    id: 21,
    userId: 11,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const liked = await request("/api/stories/21/like", { method: "POST" });
  assert.equal(liked.status, 201);
  assert.equal((await liked.json()).isLiked, true);
  assert.deepEqual(storedStoryLikes, [{ story_id: 21, user_id: 7 }]);

  const unliked = await request("/api/stories/21/like", { method: "POST" });
  assert.equal(unliked.status, 200);
  assert.equal((await unliked.json()).isLiked, false);
  assert.deepEqual(storedStoryLikes, []);

  const missingStory = await request("/api/stories/404/like", {
    method: "POST",
  });
  assert.equal(missingStory.status, 404);

  const invalidId = await request("/api/stories/not-an-id/like", {
    method: "POST",
  });
  assert.equal(invalidId.status, 400);

  const unauthenticated = await fetch(`${baseUrl}/api/stories/21/like`, {
    method: "POST",
  });
  assert.equal(unauthenticated.status, 401);
});

test("reposts support posts and reels, are idempotent, and can only be removed by their owner", async () => {
  const invalidTarget = await request("/api/reposts", {
    method: "POST",
    body: JSON.stringify({ postId: 12, reelId: 9 }),
  });
  assert.equal(invalidTarget.status, 400);

  const createdPost = await request("/api/reposts", {
    method: "POST",
    body: JSON.stringify({ postId: 12, note: "Worth a look" }),
  });
  assert.equal(createdPost.status, 201);
  const postRepost = (await createdPost.json()).data;
  assert.equal(postRepost.postId, 12);
  assert.equal(postRepost.reelId, null);
  assert.equal(postRepost.note, "Worth a look");

  const duplicatePost = await request("/api/reposts", {
    method: "POST",
    body: JSON.stringify({ postId: 12, note: "Another note" }),
  });
  assert.equal(duplicatePost.status, 200);
  assert.equal((await duplicatePost.json()).data.id, postRepost.id);
  assert.equal(storedReposts.length, 1);

  const createdReel = await request("/api/reposts", {
    method: "POST",
    body: JSON.stringify({ reel_id: 9 }),
  });
  assert.equal(createdReel.status, 201);
  assert.equal((await createdReel.json()).data.reelId, 9);

  const missingReel = await request("/api/reposts", {
    method: "POST",
    body: JSON.stringify({ reelId: 404 }),
  });
  assert.equal(missingReel.status, 404);

  const ownReposts = await request("/api/reposts");
  assert.equal((await ownReposts.json()).data.length, 2);
  const profileReposts = await request("/api/reposts/user/7", {
    authUserId: 8,
  });
  assert.equal((await profileReposts.json()).data.length, 2);

  const forbiddenDelete = await request(`/api/reposts/${postRepost.id}`, {
    method: "DELETE",
    authUserId: 8,
  });
  assert.equal(forbiddenDelete.status, 404);

  const deletedPost = await request(`/api/reposts/${postRepost.id}`, {
    method: "DELETE",
  });
  assert.equal(deletedPost.status, 200);
  assert.equal(
    (await request("/api/reposts").then((response) => response.json())).data
      .length,
    1,
  );
});

test("profile update accepts the current-user route and Flutter field names", async (t) => {
  const originalUpdateUser = userModel.updateUser;
  const originalGetUserById = userModel.getUserById;
  let saved;
  t.after(() => {
    userModel.updateUser = originalUpdateUser;
    userModel.getUserById = originalGetUserById;
  });

  userModel.updateUser = async (id, updates) => {
    saved = { id, updates };
  };
  userModel.getUserById = async (id) => ({
    id,
    name: saved.updates.fullName,
    username: saved.updates.username,
    bio: saved.updates.bio,
  });

  const response = await request("/api/users/me", {
    method: "PUT",
    body: JSON.stringify({
      full_name: "Updated Name",
      name: "Updated Name",
      username: "newname",
      bio: "",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(saved, {
    id: 7,
    updates: {
      fullName: "Updated Name",
      username: "newname",
      bio: "",
    },
  });
  assert.equal((await response.json()).data.username, "newname");
});

test("profile relationship endpoints return viewer follow status", async (t) => {
  const originalGetFollow = followModel.getFollow;
  const originalGetFollowers = followModel.getFollowers;
  const originalGetFollowing = followModel.getFollowing;
  const originalGetUserById = userModel.getUserById;
  t.after(() => {
    followModel.getFollow = originalGetFollow;
    followModel.getFollowers = originalGetFollowers;
    followModel.getFollowing = originalGetFollowing;
    userModel.getUserById = originalGetUserById;
  });

  userModel.getUserById = async (id) => ({ id, username: `user-${id}` });
  followModel.getFollow = async (viewerId, targetId) =>
    viewerId === 7 && targetId === 8 ? { id: 1 } : null;
  followModel.getFollowers = async (targetId, viewerId) => [
    { id: 9, isFollowing: viewerId === 7 },
  ];
  followModel.getFollowing = async (targetId, viewerId) => [
    { id: 10, isFollowing: viewerId === 7 },
  ];

  const profile = await request("/api/users/8");
  assert.equal((await profile.json()).data.isFollowing, true);

  const followers = await request("/api/users/8/followers");
  assert.equal((await followers.json()).data[0].isFollowing, true);

  const following = await request("/api/users/8/following");
  assert.equal((await following.json()).data[0].isFollowing, true);
});

test("profile post requests include the authenticated user's like state", async (t) => {
  const originalGetPostsByUserId = postModel.getPostsByUserId;
  let requestedBy;
  t.after(() => {
    postModel.getPostsByUserId = originalGetPostsByUserId;
  });

  postModel.getPostsByUserId = async (ownerId, viewerId) => {
    requestedBy = { ownerId, viewerId };
    return [{ id: 12, userId: ownerId, isLiked: viewerId === 7 }];
  };

  const response = await request("/api/posts/user/8");
  assert.equal(response.status, 200);
  assert.deepEqual(requestedBy, { ownerId: "8", viewerId: 7 });
  assert.equal((await response.json()).data[0].isLiked, true);
});

test("post captions and deletion are available only through the authenticated endpoints", async (t) => {
  const originalUpdate = postModel.updatePostCaption;
  const originalDelete = postModel.deletePost;
  const calls = [];
  t.after(() => {
    postModel.updatePostCaption = originalUpdate;
    postModel.deletePost = originalDelete;
  });

  postModel.updatePostCaption = async (postId, userId, caption) => {
    calls.push({ operation: "update", postId, userId, caption });
    return postId === 12 && userId === 7;
  };
  postModel.deletePost = async (postId, userId) => {
    calls.push({ operation: "delete", postId, userId });
    return postId === 12 && userId === 7;
  };

  const updated = await request("/api/posts/12", {
    method: "PUT",
    body: JSON.stringify({ caption: "Edited caption" }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(calls[0], {
    operation: "update",
    postId: 12,
    userId: 7,
    caption: "Edited caption",
  });

  const deleted = await request("/api/posts/12", { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual(calls[1], {
    operation: "delete",
    postId: 12,
    userId: 7,
  });

  postModel.deletePost = async () => false;
  assert.equal(
    (await request("/api/posts/12", { method: "DELETE" })).status,
    404,
  );
});

test("post deletion removes dependent social rows in one transaction", async (t) => {
  const originalGetConnection = db.getConnection;
  const statements = [];
  let committed = false;
  let released = false;
  t.after(() => {
    db.getConnection = originalGetConnection;
  });

  db.getConnection = async () => ({
    beginTransaction: async () => statements.push("BEGIN"),
    query: async (sql, params) => {
      statements.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (sql.includes("SELECT id FROM posts")) return [[{ id: 12 }], []];
      return [{ affectedRows: 1 }, []];
    },
    commit: async () => {
      committed = true;
    },
    rollback: async () => {
      statements.push("ROLLBACK");
    },
    release: () => {
      released = true;
    },
  });

  assert.equal(await postModel.deletePost(12, 7), true);
  assert.equal(statements[0], "BEGIN");
  assert.match(statements[1].sql, /WHERE id = \? AND user_id = \? FOR UPDATE/);
  assert.match(statements[2].sql, /DELETE FROM likes/);
  assert.match(statements[3].sql, /DELETE FROM comments/);
  assert.match(statements[4].sql, /DELETE FROM posts/);
  assert.equal(committed, true);
  assert.equal(released, true);
});

test("reel details can be loaded by canonical ID for saved-item navigation", async () => {
  const response = await request("/api/reels/9");
  assert.equal(response.status, 200);
  const reel = (await response.json()).data;
  assert.equal(reel.id, 9);
  assert.equal(reel.videoUrl, "https://cdn.example/reels/9.mp4");
  assert.equal(reel.userId, 11);

  assert.equal((await request("/api/reels/invalid")).status, 400);
  assert.equal((await request("/api/reels/404")).status, 404);
});

test("reel likes report the missing migration and database failures without false success", async () => {
  const migrationRequired = await request("/api/likes/reel/40", {
    method: "POST",
  });
  assert.equal(migrationRequired.status, 503);
  assert.equal((await migrationRequired.json()).isLiked, false);
  assert.equal(storedLikes.length, 0);

  reelLikesEnabled = true;
  const invalidId = await request("/api/reels/like/not-an-id", {
    method: "POST",
  });
  assert.equal(invalidId.status, 400);

  nextQueryError = Object.assign(new Error("database unavailable"), {
    code: "ECONNREFUSED",
  });
  const failed = await request("/api/likes/reel/40", { method: "POST" });
  assert.equal(failed.status, 500);
  const failedJson = await failed.json();
  assert.equal(failedJson.success, false);
  assert.equal(failedJson.isLiked, false);
});

test("story uploads persist Cloudinary URLs, list active stories, and reject invalid media", async () => {
  const imageUpload = await request("/api/stories", {
    method: "POST",
    body: JSON.stringify({
      mediaType: "image",
      files: undefined,
      mediaUrl: "https://res.cloudinary.com/example/image/upload/story.jpg",
    }),
  });
  assert.equal(imageUpload.status, 201);
  assert.equal(
    storedStories[0].mediaUrl,
    "https://res.cloudinary.com/example/image/upload/story.jpg",
  );

  const contentController = require("../src/controllers/contentController");
  const imageUploadResult = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await contentController.createStory(
    {
      user: { id: 7 },
      body: { mediaType: "image" },
      files: {
        media: [
          {
            path: "https://res.cloudinary.com/example/image/upload/uploaded.jpg",
            mimetype: "image/jpeg",
          },
        ],
      },
    },
    imageUploadResult,
  );
  assert.equal(imageUploadResult.statusCode, 201);
  assert.equal(
    storedStories[1].mediaUrl,
    "https://res.cloudinary.com/example/image/upload/uploaded.jpg",
  );

  const uploadResult = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await contentController.createStory(
    {
      user: { id: 7 },
      body: { mediaType: "video" },
      files: {
        story: [
          {
            path: "https://res.cloudinary.com/example/video/upload/story.mp4",
            mimetype: "video/mp4",
          },
        ],
      },
    },
    uploadResult,
  );
  assert.equal(uploadResult.statusCode, 201);
  assert.equal(storedStories[2].mediaType, "video");
  assert.equal(
    storedStories[2].mediaUrl,
    "https://res.cloudinary.com/example/video/upload/story.mp4",
  );

  const invalidUploadResult = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await contentController.createStory(
    {
      user: { id: 7 },
      body: { mediaType: "image" },
      files: { story: [{ path: "not-a-url", mimetype: "application/pdf" }] },
    },
    invalidUploadResult,
  );
  assert.equal(invalidUploadResult.statusCode, 400);

  const expiredResult = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await contentController.createStory(
    {
      user: { id: 7 },
      body: {
        mediaUrl: "https://res.cloudinary.com/example/image/upload/expired.jpg",
        expiresAt: "2020-01-01T00:00:00Z",
      },
    },
    expiredResult,
  );
  assert.equal(expiredResult.statusCode, 400);

  const failedStoryResult = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  nextQueryError = Object.assign(new Error("database unavailable"), {
    code: "ECONNREFUSED",
  });
  await contentController.createStory(
    {
      user: { id: 7 },
      body: {
        mediaUrl: "https://res.cloudinary.com/example/image/upload/fails.jpg",
      },
    },
    failedStoryResult,
  );
  assert.equal(failedStoryResult.statusCode, 500);
  assert.equal(failedStoryResult.body.success, false);

  storedStories.push({
    id: 999,
    userId: 7,
    mediaUrl: "https://res.cloudinary.com/example/image/upload/expired.jpg",
    mediaType: "image",
    expiresAt: new Date("2020-01-01T00:00:00Z"),
  });

  const active = await request("/api/stories");
  assert.equal(active.status, 200);
  const stories = (await active.json()).data;
  assert.equal(stories.length, 3);
  assert.ok(stories.every((story) => new Date(story.expires_at) > new Date()));
});

test("local health endpoint responds successfully", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
});

test("new post, comment, story, notification, and auth routes validate IDs and required tokens", async () => {
  assert.equal((await request("/api/posts/not-an-id")).status, 400);
  assert.equal(
    (await request("/api/comments/not-an-id/like", { method: "POST" })).status,
    400,
  );
  assert.equal(
    (
      await request("/api/comments/not-an-id", {
        method: "PUT",
        body: JSON.stringify({ comment: "Updated text" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/api/stories/not-an-id/view", { method: "PUT" })).status,
    400,
  );
  assert.equal(
    (await request("/api/notifications/not-an-id/read", { method: "PUT" }))
      .status,
    400,
  );
  assert.equal(
    (
      await request("/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      })
    ).status,
    400,
  );
});
