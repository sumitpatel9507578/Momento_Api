const db = require("../config/db");

// Create a post for an authenticated user
async function createPost(userId, caption, mediaUrl, mediaType) {
  const [result] = await db.query(
    `INSERT INTO posts (user_id, caption, media_url, media_type)
     VALUES (?, ?, ?, ?)`,
    [userId, caption || null, mediaUrl || null, mediaType || null],
  );

  return getPostById(result.insertId);
}

// Find a post by id with user info
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

// Get all posts for home feed
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

// Get posts for a specific user
async function getPostsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name, u.profile_image
     FROM posts p
     JOIN users u ON p.user_id = u.id
     WHERE p.user_id = ?
     ORDER BY p.created_at DESC`,
    [userId],
  );
  return rows;
}

// Find an existing like
async function getLike(userId, postId) {
  const [rows] = await db.query(
    `SELECT id FROM likes WHERE user_id = ? AND post_id = ?`,
    [userId, postId],
  );
  return rows[0];
}

// Create a like
async function createLike(userId, postId) {
  const [result] = await db.query(
    `INSERT INTO likes (user_id, post_id) VALUES (?, ?)`,
    [userId, postId],
  );
  return result.insertId;
}

// Create a comment
async function createComment(userId, postId, comment) {
  const [result] = await db.query(
    `INSERT INTO comments (user_id, post_id, comment) VALUES (?, ?, ?)`,
    [userId, postId, comment],
  );
  return result.insertId;
}

// Reels Logic
async function createReel(userId, videoUrl, caption, songId) {
  const [result] = await db.query(
    `INSERT INTO reels (user_id, video_url, caption, song_name) VALUES (?, ?, ?, ?)`,
    [userId, videoUrl, caption || null, songId || null],
  );
  return result.insertId;
}

async function getReels(limit = 10, offset = 0) {
  const [rows] = await db.query(
    `SELECT r.*, u.username as creator_name, u.profile_image as thumbnail
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

// Stories Logic
async function createStory(userId, mediaUrl, mediaType, caption, expiresAt) {
  const [result] = await db.query(
    `INSERT INTO stories (user_id, media_url, media_type, caption, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, mediaUrl, mediaType || null, caption || null, expiresAt],
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

module.exports = {
  createComment,
  createLike,
  createPost,
  createReel,
  createStory,
  getLike,
  getPostById,
  getFeed,
  getPostsByUserId,
  getReels,
  getReelsByUserId,
  getActiveStories
};
