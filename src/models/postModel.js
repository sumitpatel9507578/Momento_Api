const db = require("../config/db");

// Helper to get columns from a table
async function getTableCols(tableName) {
  try {
    const [columns] = await db.query(`SHOW COLUMNS FROM ${tableName}`);
    return columns.map((c) => c.Field);
  } catch (err) {
    return [];
  }
}

async function createPost(userId, caption, mediaUrl, mediaType) {
  const cols = await getTableCols("posts");
  const uIdCol = cols.includes("userId") ? "userId" : "user_id";
  const urlCol = cols.includes("mediaUrl") ? "mediaUrl" : "media_url";
  const typeCol = cols.includes("mediaType") ? "mediaType" : "media_type";

  const query = `INSERT INTO posts (${uIdCol}, caption, ${urlCol}, ${typeCol}) VALUES (?, ?, ?, ?)`;
  const [result] = await db.query(query, [
    userId,
    caption || null,
    mediaUrl || null,
    mediaType || "image",
  ]);
  return getPostById(result.insertId);
}

async function getPostById(postId) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name, u.profileImage FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [postId],
  );
  return _mapPost(rows[0]);
}

async function getFeed(limit = 20, offset = 0) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name AS name, u.profileImage AS profile_image,
     (SELECT COUNT(*) FROM likes WHERE postId = p.id OR post_id = p.id) as likesCount,
     (SELECT COUNT(*) FROM comments WHERE postId = p.id OR post_id = p.id) as commentsCount
     FROM posts p
     JOIN users u ON p.user_id = u.id
     ORDER BY p.created_at DESC
     LIMIT ?, ?`,
    [offset, limit],
  );
  return rows.map(_mapPost);
}

async function getPostsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name, u.profileImage
     FROM posts p
     JOIN users u ON p.user_id = u.id
     WHERE p.user_id = ?
     ORDER BY p.id DESC`,
    [userId],
  );
  return rows.map(_mapPost);
}

function _mapPost(p) {
  if (!p) return null;
  return {
    id: p.id,
    userId: p.userId || p.user_id,
    username: p.username || "Anonymous",
    name: p.full_name || p.name || "",
    profileImage: p.profileImage || p.profile_image || "",
    mediaUrl: p.mediaUrl || p.media_url || "",
    mediaType: p.mediaType || p.media_type || "image",
    caption: p.caption || "",
    likesCount: p.likesCount || 0,
    commentsCount: p.commentsCount || 0,
    createdAt: p.createdAt || p.created_at || null,
  };
}

// --- Social ---
async function getLike(userId, postId, reelId = null) {
  let query = "SELECT id FROM likes WHERE (userId = ? OR user_id = ?)";
  let params = [userId, userId];
  if (postId) {
    query += " AND (postId = ? OR post_id = ?)";
    params.push(postId, postId);
  } else if (reelId) {
    query += " AND (reelId = ? OR reel_id = ?)";
    params.push(reelId, reelId);
  }
  const [rows] = await db.query(query, params);
  return rows[0];
}

async function createLike(userId, postId, reelId = null) {
  const cols = await getTableCols("likes");
  const uIdCol = cols.includes("userId") ? "userId" : "user_id";
  const pIdCol = cols.includes("postId") ? "postId" : "post_id";
  const rIdCol = cols.includes("reelId") ? "reelId" : "reel_id";
  await db.query(
    `INSERT INTO likes (${uIdCol}, ${pIdCol}, ${rIdCol}) VALUES (?, ?, ?)`,
    [userId, postId, reelId],
  );
}

async function deleteLike(userId, postId, reelId = null) {
  const uIdCol = (await getTableCols("likes")).includes("userId")
    ? "userId"
    : "user_id";
  let query = `DELETE FROM likes WHERE ${uIdCol} = ?`;
  let params = [userId];
  if (postId) {
    const pIdCol = (await getTableCols("likes")).includes("postId")
      ? "postId"
      : "post_id";
    query += ` AND ${pIdCol} = ?`;
    params.push(postId);
  } else if (reelId) {
    const rIdCol = (await getTableCols("likes")).includes("reelId")
      ? "reelId"
      : "reel_id";
    query += ` AND ${rIdCol} = ?`;
    params.push(reelId);
  }
  await db.query(query, params);
}

async function createComment(userId, postId, comment, reelId = null) {
  const cols = await getTableCols("comments");
  const uIdCol = cols.includes("userId") ? "userId" : "user_id";
  const pIdCol = cols.includes("postId") ? "postId" : "post_id";
  const rIdCol = cols.includes("reelId") ? "reelId" : "reel_id";
  await db.query(
    `INSERT INTO comments (${uIdCol}, ${pIdCol}, ${rIdCol}, comment) VALUES (?, ?, ?, ?)`,
    [userId, postId, reelId, comment],
  );
}

async function getCommentsByPostId(postId) {
  const [rows] = await db.query(
    `SELECT c.*, u.username, u.profileImage, u.profile_image FROM comments c JOIN users u ON (c.userId = u.id OR c.user_id = u.id) WHERE c.postId = ? OR c.post_id = ? ORDER BY c.id DESC`,
    [postId, postId],
  );
  return rows;
}

async function getCommentsByReelId(reelId) {
  const [rows] = await db.query(
    `SELECT c.*, u.username, u.profileImage, u.profile_image FROM comments c JOIN users u ON (c.userId = u.id OR c.user_id = u.id) WHERE c.reelId = ? OR c.reel_id = ? ORDER BY c.id DESC`,
    [reelId, reelId],
  );
  return rows;
}

// --- Reels ---
async function createReel(userId, videoUrl, caption, songId) {
  const cols = await getTableCols("reels");
  const uIdCol = cols.includes("userId") ? "userId" : "user_id";
  const urlCol = cols.includes("videoUrl") ? "videoUrl" : "video_url";
  await db.query(
    `INSERT INTO reels (${uIdCol}, ${urlCol}, caption, songId) VALUES (?, ?, ?, ?)`,
    [userId, videoUrl, caption, songId],
  );
}

async function getReels(limit = 10, offset = 0) {
  const [rows] = await db.query(
    `SELECT r.*, u.username as creator_name, u.profileImage, u.profile_image,
     (SELECT COUNT(*) FROM likes WHERE reelId = r.id OR reel_id = r.id) as likes_count,
     (SELECT COUNT(*) FROM comments WHERE reelId = r.id OR reel_id = r.id) as comments_count
     FROM reels r JOIN users u ON (r.userId = u.id OR r.user_id = u.id) ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map((r) => ({
    ...r,
    userId: r.userId || r.user_id,
    videoUrl: r.videoUrl || r.video_url,
    thumbnail: r.profileImage || r.profile_image || "",
  }));
}

// --- Stories ---
async function createStory(userId, mediaUrl, mediaType, caption, expiresAt) {
  const cols = await getTableCols("stories");
  const uIdCol = cols.includes("userId") ? "userId" : "user_id";
  const urlCol = cols.includes("mediaUrl") ? "mediaUrl" : "media_url";
  await db.query(
    `INSERT INTO stories (${uIdCol}, ${urlCol}, mediaType, caption, expiresAt) VALUES (?, ?, ?, ?, ?)`,
    [userId, mediaUrl, mediaType, caption, expiresAt],
  );
}

async function getActiveStories() {
  const [rows] = await db.query(
    `SELECT s.*, u.username, u.profileImage, u.profile_image FROM stories s JOIN users u ON (s.userId = u.id OR s.user_id = u.id) WHERE (s.expiresAt > NOW() OR s.expires_at > NOW()) ORDER BY s.id DESC`,
  );
  return rows.map((s) => ({
    ...s,
    userId: s.userId || s.user_id,
    mediaUrl: s.mediaUrl || s.media_url,
    profileImage: s.profileImage || s.profile_image,
  }));
}

module.exports = {
  createPost,
  getPostById,
  getFeed,
  getPostsByUserId,
  getLike,
  createLike,
  deleteLike,
  createComment,
  getCommentsByPostId,
  getCommentsByReelId,
  createReel,
  getReels,
  createStory,
  getActiveStories,
  createMessage: async () => {}, // placeholder
  getMessages: async () => [],
  getConversations: async () => [],
};
