const db = require("../config/db");

async function getRelationshipUsers(userId, direction) {
  const [userColumns] = await db.query("SHOW COLUMNS FROM users");
  const columns = userColumns.map((column) => column.Field);
  const nameColumn = columns.includes("name") ? "name" : "full_name";
  const imageColumn = columns.includes("profile_image")
    ? "profile_image"
    : "profileImage";
  const relationshipColumn =
    direction === "followers" ? "f.following_id" : "f.follower_id";
  const selectedUserColumn =
    direction === "followers" ? "f.follower_id" : "f.following_id";

  const [rows] = await db.query(
    `SELECT u.id, u.username, u.${nameColumn} AS name,
            u.${imageColumn} AS profile_image
     FROM users u
     JOIN follows f ON u.id = ${selectedUserColumn}
     WHERE ${relationshipColumn} = ?
     ORDER BY u.id DESC`,
    [userId],
  );

  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name || "",
    profile_image: user.profile_image || "",
  }));
}

async function getFollowers(userId) {
  return getRelationshipUsers(userId, "followers");
}

async function getFollowing(userId) {
  return getRelationshipUsers(userId, "following");
}

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
  getFollowers,
  getFollowing,
  deleteFollow: async (followerId, followingId) => {
    const [result] = await db.query(
      "DELETE FROM follows WHERE follower_id = ? AND following_id = ?",
      [followerId, followingId],
    );
    return result.affectedRows > 0;
  },
};
