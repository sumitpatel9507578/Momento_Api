const db = require("../config/db");

// Create a post for an authenticated user
async function createPost(userId, caption, mediaUrl, mediaType) {
  const [result] = await db.query(
    `INSERT INTO posts (userId, caption, mediaUrl, mediaType)
     VALUES (?, ?, ?, ?)`,
    [userId, caption || null, mediaUrl || null, mediaType || 'image'],
  );

  return getPostById(result.insertId);
}

// Find a post by id with user info
async function getPostById(postId) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name as fullName, u.profileImage
     FROM posts p
     JOIN users u ON p.userId = u.id
     WHERE p.id = ?`,
    [postId],
  );

  return rows[0];
}

// Get all posts for home feed with correct subqueries
async function getFeed(limit = 20, offset = 0) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name as fullName, u.profileImage,
     (SELECT COUNT(*) FROM likes WHERE postId = p.id) as likesCount,
     (SELECT COUNT(*) FROM comments WHERE postId = p.id) as commentsCount
     FROM posts p
     JOIN users u ON p.userId = u.id
     ORDER BY p.createdAt DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows;
}

// Get posts for a specific user
async function getPostsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name as fullName, u.profileImage,
     (SELECT COUNT(*) FROM likes WHERE postId = p.id) as likesCount,
     (SELECT COUNT(*) FROM comments WHERE postId = p.id) as commentsCount
     FROM posts p
     JOIN users u ON p.userId = u.id
     WHERE p.userId = ?
     ORDER BY p.createdAt DESC`,
    [userId],
  );
  return rows;
}

// Find an existing like
async function getLike(userId, postId) {
  const [rows] = await db.query(
    `SELECT id FROM likes WHERE userId = ? AND postId = ?`,
    [userId, postId],
  );
  return rows[0];
}

// Create a like
async function createLike(userId, postId) {
  const [result] = await db.query(
    `INSERT INTO likes (userId, postId) VALUES (?, ?)`,
    [userId, postId],
  );
  return result.insertId;
}

// Create a comment
async function createComment(userId, postId, comment, reelId = null) {
  const [result] = await db.query(
    `INSERT INTO comments (userId, postId, reelId, comment) VALUES (?, ?, ?, ?)`,
    [userId, postId || null, reelId || null, comment],
  );
  return result.insertId;
}

// Get comments for a specific post
async function getCommentsByPostId(postId) {
  const [rows] = await db.query(
    `SELECT c.*, u.username, u.profileImage
     FROM comments c
     JOIN users u ON c.userId = u.id
     WHERE c.postId = ?
     ORDER BY c.createdAt DESC`,
    [postId],
  );
  return rows;
}

// Get comments for a specific reel
async function getCommentsByReelId(reelId) {
  const [rows] = await db.query(
    `SELECT c.*, u.username, u.profileImage
     FROM comments c
     JOIN users u ON c.userId = u.id
     WHERE c.reelId = ?
     ORDER BY c.createdAt DESC`,
    [reelId],
  );
  return rows;
}

// Reels Logic
async function createReel(userId, videoUrl, caption, songId) {
  const [result] = await db.query(
    `INSERT INTO reels (userId, videoUrl, caption, song_name) VALUES (?, ?, ?, ?)`,
    [userId, videoUrl, caption || null, songId || null],
  );
  return result.insertId;
}

async function getReels(limit = 10, offset = 0) {
  const [rows] = await db.query(
    `SELECT r.*, u.username as creator_name, u.profileImage as thumbnail
     FROM reels r
     JOIN users u ON r.userId = u.id
     ORDER BY r.createdAt DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows;
}

async function getReelsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT r.*, u.username as creator_name, u.profileImage as thumbnail
     FROM reels r
     JOIN users u ON r.userId = u.id
     WHERE r.userId = ?
     ORDER BY r.createdAt DESC`,
    [userId],
  );
  return rows;
}

// Stories Logic
async function createStory(userId, mediaUrl, mediaType, caption, expiresAt) {
  const [result] = await db.query(
    `INSERT INTO stories (userId, mediaUrl, mediaType, caption, expiresAt)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, mediaUrl, mediaType || 'image', caption || null, expiresAt],
  );
  return result.insertId;
}

async function getActiveStories() {
  const [rows] = await db.query(
    `SELECT s.*, u.username, u.profileImage
     FROM stories s
     JOIN users u ON s.userId = u.id
     WHERE s.expiresAt > NOW()
     ORDER BY s.createdAt DESC`
  );
  return rows;
}

module.exports = {
  createComment,
  createLike,
  createMessage: async () => {}, // placeholder
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
