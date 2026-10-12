process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_NAME = process.env.DB_NAME || "momento_test";
process.env.JWT_SECRET = "test-only-jwt-secret";

const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const db = require("../src/config/db");
const userModel = require("../src/models/userModel");

const messageColumns = [
  "id",
  "sender_id",
  "receiver_id",
  "message",
  "message_type",
  "media_url",
  "is_read",
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
let reelLikesEnabled = false;
let reelMessagesEnabled = false;
let storedMessages = [];
let storedLikes = [];
let storedStories = [];
let savedMessages = [];
let savedReels = [];
let savedItemsSchemaEnabled = true;
let nextMessageId = 1;
let lastConversationQuery = "";
let nextStoryId = 1;
let nextQueryError = null;
let server;
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
    /FROM (?:saved_messages|saved_reels)|INTO (?:saved_messages|saved_reels)/i.test(
      normalizedSql,
    )
  ) {
    throw Object.assign(new Error("table does not exist"), {
      code: "ER_NO_SUCH_TABLE",
    });
  }
  const table = normalizedSql.match(/^SHOW COLUMNS FROM (\w+)/i)?.[1];
  if (table === "messages") {
    return columnRows(
      reelMessagesEnabled ? [...messageColumns, "reel_id"] : messageColumns,
    );
  }
  if (table === "likes") {
    return columnRows(reelLikesEnabled ? [...likeColumns, "reel_id"] : likeColumns);
  }
  if (table === "stories") return columnRows(storyColumns);
  if (table === "users") {
    return columnRows(["id", "username", "full_name", "profile_image"]);
  }
  if (table === "saved_messages" || table === "saved_reels") {
    if (!savedItemsSchemaEnabled) {
      throw Object.assign(new Error("table does not exist"), {
        code: "ER_NO_SUCH_TABLE",
      });
    }
    return columnRows(
      table === "saved_messages"
        ? ["user_id", "message_id", "saved_at"]
        : ["user_id", "reel_id", "saved_at"],
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

  const targetMatch = normalizedSql.match(/^SELECT id FROM (posts|reels) WHERE id = \?/);
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

  if (normalizedSql.startsWith("SELECT id, sender_id, receiver_id FROM messages")) {
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
    savedMessages.push({ user_id: userId, message_id: messageId, saved_at: new Date() });
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
        (bookmark) => bookmark.user_id === userId && bookmark.reel_id === reelId,
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

  if (normalizedSql.startsWith("SELECT m.id AS itemId, sm.saved_at AS savedAt")) {
    const userId = Number(params[2]);
    return [
      savedMessages
        .filter((bookmark) => bookmark.user_id === userId)
        .map((bookmark) => {
          const message = storedMessages.find(
            (entry) => entry.id === bookmark.message_id,
          );
          const conversationUserId =
            message.sender_id === userId ? message.receiver_id : message.sender_id;
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

  if (normalizedSql.startsWith("SELECT r.id AS itemId, sr.saved_at AS savedAt")) {
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
    const [senderId, receiverId, message, messageType, mediaUrl, reelId] = params;
    const record = {
      id: nextMessageId++,
      sender_id: senderId,
      receiver_id: receiverId,
      message,
      message_type: messageType,
      media_url: mediaUrl,
      reel_id: reelMessagesEnabled ? reelId ?? null : null,
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
              reelId: message.reel_id,
              reelVideoUrl: message.reel_id
                ? `https://cdn.example/reels/${message.reel_id}.mp4`
                : null,
              reelCaption: message.reel_id ? `Reel ${message.reel_id}` : null,
              reelOwnerId: message.reel_id ? 11 : null,
              reelOwnerUsername: message.reel_id ? "reel-owner" : null,
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
    normalizedSql.includes("WHERE (m.sender_id = ? AND m.receiver_id = ?")
  ) {
    const [userId, otherUserId] = params;
    const rows = storedMessages
      .filter(
        (message) =>
          (message.sender_id === userId && message.receiver_id === otherUserId) ||
          (message.sender_id === otherUserId && message.receiver_id === userId),
      )
      .sort((left, right) => left.created_at - right.created_at || left.id - right.id)
      .map((message) => ({
        id: message.id,
        senderId: message.sender_id,
        receiverId: message.receiver_id,
        message: message.message,
        messageType: message.message_type,
        mediaUrl: message.media_url,
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
      if (message.sender_id !== userId && message.receiver_id !== userId) continue;
      const conversationUserId =
        message.sender_id === userId ? message.receiver_id : message.sender_id;
      const previous = latestByParticipant.get(conversationUserId);
      if (!previous || message.created_at > previous.created_at) {
        latestByParticipant.set(conversationUserId, message);
      }
    }
    return [
      [...latestByParticipant.entries()].map(([conversationUserId, message]) => ({
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
      })),
      [],
    ];
  }

  if (normalizedSql.startsWith("INSERT INTO stories")) {
    const [userId, mediaUrl, mediaType, caption, expiresAt] = params;
    const id = nextStoryId++;
    storedStories.push({ id, userId, mediaUrl, mediaType, caption, expiresAt });
    return [{ insertId: id }, []];
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
        authToken || `Bearer ${jwt.sign({ id: authUserId }, process.env.JWT_SECRET)}`,
    },
  });
}

before(async () => {
  db.query = fakeQuery;
  userModel.getUserById = async (id) =>
    Number(id) === 404 ? null : { id: Number(id), username: `user-${id}` };
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  reelLikesEnabled = false;
  reelMessagesEnabled = false;
  storedMessages = [];
  storedLikes = [];
  storedStories = [];
  savedMessages = [];
  savedReels = [];
  savedItemsSchemaEnabled = true;
  nextMessageId = 1;
  lastConversationQuery = "";
  nextStoryId = 1;
  nextQueryError = null;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.end();
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

test("saved messages and reels persist per user, are idempotent, and do not mutate content", async () => {
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
  assert.equal(savedMessages.some((bookmark) => bookmark.user_id === 7), true);

  const saveReel = await request("/api/saved-items/reels/9", {
    method: "POST",
  });
  assert.equal(saveReel.status, 200);
  const duplicateReelSave = await request("/api/saved-items/reels/9", {
    method: "POST",
  });
  assert.equal((await duplicateReelSave.json()).data.alreadySaved, true);
  assert.equal(savedReels.length, 1);
  assert.equal(storedLikes.length, 0);

  const savedItemsResponse = await request("/api/saved-items");
  assert.equal(savedItemsResponse.status, 200);
  const items = (await savedItemsResponse.json()).data;
  assert.deepEqual(
    items.map((item) => item.itemType).sort(),
    ["message", "reel"],
  );
  assert.equal(items.find((item) => item.itemType === "reel").videoUrl,
    "https://cdn.example/reels/9.mp4");
  assert.equal(items.find((item) => item.itemType === "message").message,
    "bookmark me");
  assert.deepEqual(storedMessages[0], originalMessage);

  assert.equal(
    (await request(`/api/saved-items/messages/${message.id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal(
    (await request("/api/saved-items/reels/9", { method: "DELETE" })).status,
    200,
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

  const expiredToken = jwt.sign(
    { id: 7 },
    process.env.JWT_SECRET,
    { expiresIn: -1 },
  );
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
  const migrationRequired = await request("/api/likes/reel/40", { method: "POST" });
  assert.equal(migrationRequired.status, 503);
  assert.equal((await migrationRequired.json()).isLiked, false);
  assert.equal(storedLikes.length, 0);

  reelLikesEnabled = true;
  const invalidId = await request("/api/reels/like/not-an-id", { method: "POST" });
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
