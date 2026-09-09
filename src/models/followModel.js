const db = require("../config/db");

// Find an existing follow relationship between two users
async function getFollow(followerId, followingId) {
  const [rows] = await db.query(
    `SELECT id, follower_id, following_id, created_at
     FROM follows
     WHERE follower_id = ? AND following_id = ?`,
    [followerId, followingId],
  );

  return rows[0];
}

// Create a follow relationship between two users
async function createFollow(followerId, followingId) {
  const [result] = await db.query(
    `INSERT INTO follows (follower_id, following_id)
     VALUES (?, ?)`,
    [followerId, followingId],
  );

  const [rows] = await db.query(
    `SELECT id, follower_id, following_id, created_at
     FROM follows
     WHERE id = ?`,
    [result.insertId],
  );

  return rows[0];
}

module.exports = {
  createFollow,
  getFollow,
};
