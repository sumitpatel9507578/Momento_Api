const db = require("../config/db");

// --- Posts Logic ---

async function createPost(userId, caption, mediaUrl, mediaType) {
  const [result] = await db.query(
    `INSERT INTO posts (user_id, caption, media_url, media_type)
     VALUES (?, ?, ?, ?)`,
    [userId, caption || null, mediaUrl || null, mediaType || 'image'],
  );
  return getPostById(result.insertId);
}

async function getPostById(postId) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name, u.profile_image
     FROM posts p
     JOIN users u ON p.user_id = u.id
     WHERE p.id = ?`,
    [postId],
  );
  return rows[0];
}

async function getFeed(limit = 20, offset = 0) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name, u.profile_image,
     (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
     (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
     FROM posts p
     JOIN users u ON p.user_id = u.id
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows;
}

async function getPostsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name, u.profile_image,
     (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count
     FROM posts p
     JOIN users u ON p.user_id = u.id
     WHERE p.user_id = ?
     ORDER BY p.created_at DESC`,
    [userId],
  );
  return rows;
}

// --- Likes Logic (Post & Reel) ---

async function getLike(userId, postId, reelId = null) {
  let query = "SELECT id FROM likes WHERE user_id = ?";
  let params = [userId];

  if (postId) {
    query += " AND post_id = ?";
    params.push(postId);
  } else if (reelId) {
    query += " AND reel_id = ?";
    params.push(reelId);
  } else {
    return null;
  }

  const [rows] = await db.query(query, params);
  return rows[0];
}

async function createLike(userId, postId, reelId = null) {
  const [result] = await db.query(
    `INSERT INTO likes (user_id, post_id, reel_id) VALUES (?, ?, ?)`,
    [userId, postId || null, reelId || null],
  );
  return result.insertId;
}

async function deleteLike(userId, postId, reelId = null) {
  let query = "DELETE FROM likes WHERE user_id = ?";
  let params = [userId];

  if (postId) {
    query += " AND post_id = ?";
    params.push(postId);
  } else if (reelId) {
    query += " AND reel_id = ?";
    params.push(reelId);
  }

  const [result] = await db.query(query, params);
  return result.affectedRows > 0;
}

// --- Comments Logic ---

async function createComment(userId, postId, comment, reelId = null) {
  const [result] = await db.query(
    `INSERT INTO comments (user_id, post_id, reel_id, comment) VALUES (?, ?, ?, ?)`,
    [userId, postId || null, reelId || null, comment],
  );
  return result.insertId;
}

async function getCommentsByPostId(postId) {
  const [rows] = await db.query(
    `SELECT c.*, u.username, u.profile_image
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.post_id = ?
     ORDER BY c.created_at DESC`,
    [postId],
  );
  return rows;
}

async function getCommentsByReelId(reelId) {
  const [rows] = await db.query(
    `SELECT c.*, u.username, u.profile_image
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.reel_id = ?
     ORDER BY c.created_at DESC`,
    [reelId],
  );
  return rows;
}

// --- Reels Logic ---

async function createReel(userId, videoUrl, caption, songName) {
  const [result] = await db.query(
    `INSERT INTO reels (user_id, video_url, caption, song_name) VALUES (?, ?, ?, ?)`,
    [userId, videoUrl, caption || null, songName || null],
  );
  return result.insertId;
}

async function getReels(limit = 10, offset = 0) {
  const [rows] = await db.query(
    `SELECT r.*, u.username as creator_name, u.profile_image as thumbnail,
     (SELECT COUNT(*) FROM likes WHERE reel_id = r.id) as likes_count,
     (SELECT COUNT(*) FROM comments WHERE reel_id = r.id) as comments_count
     FROM reels r
     JOIN users u ON r.user_id = u.id
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows;
}

async function getReelsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT r.*, u.username as creator_name, u.profile_image as thumbnail
     FROM reels r
     JOIN users u ON r.user_id = u.id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC`,
    [userId],
  );
  return rows;
}

// --- Stories Logic ---

async function createStory(userId, mediaUrl, mediaType, caption, expiresAt) {
  const [result] = await db.query(
    `INSERT INTO stories (user_id, media_url, media_type, caption, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, mediaUrl, mediaType || 'image', caption || null, expiresAt],
  );
  return result.insertId;
}

async function getActiveStories() {
  const [rows] = await db.query(
    `SELECT s.*, u.username, u.profile_image
     FROM stories s
     JOIN users u ON s.user_id = u.id
     WHERE s.expires_at > NOW()
     ORDER BY s.created_at DESC`
  );
  return rows;
}

// --- Messages Logic ---

async function createMessage(senderId, receiverId, message, messageType) {
  const [result] = await db.query(
    `INSERT INTO messages (sender_id, receiver_id, message, message_type)
     VALUES (?, ?, ?, ?)`,
    [senderId, receiverId, message, messageType || "text"],
  );
  return result.insertId;
}

async function getMessages(senderId, receiverId) {
  const [rows] = await db.query(
    `SELECT * FROM messages
     WHERE (sender_id = ? AND receiver_id = ?)
        OR (sender_id = ? AND receiver_id = ?)
     ORDER BY created_at ASC`,
    [senderId, receiverId, receiverId, senderId],
  );
  return rows;
}

async function getConversations(userId) {
  const [rows] = await db.query(
    `SELECT DISTINCT u.id, u.username, u.full_name, u.profile_image,
     (SELECT message FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id) ORDER BY created_at DESC LIMIT 1) as lastMessage,
     (SELECT created_at FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id) ORDER BY created_at DESC LIMIT 1) as lastMessageTime
     FROM users u
     JOIN messages m ON (m.sender_id = u.id AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = u.id)
     WHERE u.id != ?`,
    [userId, userId, userId, userId, userId, userId, userId],
  );
  return rows;
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
  getReelsByUserId,
  createStory,
  getActiveStories,
  createMessage,
  getMessages,
  getConversations
};
