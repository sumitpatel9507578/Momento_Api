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

// Find a post by id without exposing database errors
async function getPostById(postId) {
  const [rows] = await db.query(
    `SELECT id, user_id, caption, media_url, media_type, created_at
     FROM posts
     WHERE id = ?`,
    [postId],
  );

  return rows[0];
}

// Find an existing like for a user and post
async function getLike(userId, postId) {
  const [rows] = await db.query(
    `SELECT id, user_id, post_id, created_at
     FROM likes
     WHERE user_id = ? AND post_id = ?`,
    [userId, postId],
  );

  return rows[0];
}

// Create a like for an authenticated user
async function createLike(userId, postId) {
  const [result] = await db.query(
    `INSERT INTO likes (user_id, post_id)
     VALUES (?, ?)`,
    [userId, postId],
  );

  const [rows] = await db.query(
    `SELECT id, user_id, post_id, created_at
     FROM likes
     WHERE id = ?`,
    [result.insertId],
  );

  return rows[0];
}

// Create a comment on an existing post
async function createComment(userId, postId, comment) {
  const [result] = await db.query(
    `INSERT INTO comments (user_id, post_id, comment)
     VALUES (?, ?, ?)`,
    [userId, postId, comment],
  );

  const [rows] = await db.query(
    `SELECT id, user_id, post_id, comment, created_at
     FROM comments
     WHERE id = ?`,
    [result.insertId],
  );

  return rows[0];
}

// Create a reel using the existing song_name database column
async function createReel(userId, videoUrl, caption, songId) {
  const [result] = await db.query(
    `INSERT INTO reels (user_id, video_url, caption, song_name)
     VALUES (?, ?, ?, ?)`,
    [userId, videoUrl, caption || null, songId || null],
  );

  const [rows] = await db.query(
    `SELECT id, user_id, video_url, caption, song_name, created_at
     FROM reels
     WHERE id = ?`,
    [result.insertId],
  );

  return rows[0];
}

// Create a story with a supplied or default expiration time
async function createStory(userId, mediaUrl, mediaType, caption, expiresAt) {
  const [result] = await db.query(
    `INSERT INTO stories (user_id, media_url, media_type, caption, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, mediaUrl, mediaType || null, caption || null, expiresAt],
  );

  const [rows] = await db.query(
    `SELECT id, user_id, media_url, media_type, caption, expires_at, created_at
     FROM stories
     WHERE id = ?`,
    [result.insertId],
  );

  return rows[0];
}

// Create a message using the authenticated user as sender
async function createMessage(senderId, receiverId, message, messageType) {
  const [result] = await db.query(
    `INSERT INTO messages (sender_id, receiver_id, message, message_type)
     VALUES (?, ?, ?, ?)`,
    [senderId, receiverId, message, messageType || "text"],
  );

  const [rows] = await db.query(
    `SELECT id, sender_id, receiver_id, message, message_type, media_url, is_read, created_at
     FROM messages
     WHERE id = ?`,
    [result.insertId],
  );

  return rows[0];
}

module.exports = {
  createComment,
  createLike,
  createMessage,
  createPost,
  createReel,
  createStory,
  getLike,
  getPostById,
};
