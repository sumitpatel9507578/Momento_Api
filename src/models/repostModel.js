const db = require("../config/db");

function makeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getTarget(postId, reelId) {
  const hasPostId = postId !== null && postId !== undefined;
  const hasReelId = reelId !== null && reelId !== undefined;
  if (hasPostId === hasReelId) {
    throw makeError(
      "Provide exactly one postId or reelId",
      "INVALID_REPOST_TARGET",
    );
  }
  return hasPostId
    ? { table: "posts", column: "post_id", id: postId }
    : { table: "reels", column: "reel_id", id: reelId };
}

function mapRepost(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId ?? row.user_id,
    postId: row.postId ?? row.post_id ?? null,
    reelId: row.reelId ?? row.reel_id ?? null,
    note: row.note ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
  };
}

async function getRepostById(repostId) {
  const [rows] = await db.query("SELECT * FROM reposts WHERE id = ?", [
    repostId,
  ]);
  return mapRepost(rows[0]);
}

async function getExistingRepost(userId, target) {
  const [rows] = await db.query(
    `SELECT * FROM reposts WHERE user_id = ? AND ${target.column} = ? LIMIT 1`,
    [userId, target.id],
  );
  return mapRepost(rows[0]);
}

async function createRepost(userId, postId, reelId, note = null) {
  const target = getTarget(postId, reelId);
  const [content] = await db.query(
    `SELECT id FROM ${target.table} WHERE id = ?`,
    [target.id],
  );
  if (!content[0]) {
    throw makeError(
      `${target.table === "posts" ? "Post" : "Reel"} not found`,
      "REPOST_TARGET_NOT_FOUND",
    );
  }

  const existing = await getExistingRepost(userId, target);
  if (existing) return { ...existing, alreadyReposted: true };

  try {
    const [result] = await db.query(
      `INSERT INTO reposts (user_id, post_id, reel_id, note)
       VALUES (?, ?, ?, ?)`,
      [userId, postId, reelId, note],
    );
    const repost = await getRepostById(result.insertId);
    return { ...repost, alreadyReposted: false };
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY") throw error;
    const repost = await getExistingRepost(userId, target);
    if (repost) return { ...repost, alreadyReposted: true };
    throw error;
  }
}

async function getRepostsByUser(userId) {
  const [rows] = await db.query(
    `SELECT * FROM reposts WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
    [userId],
  );
  return rows.map(mapRepost);
}

async function deleteRepost(userId, repostId) {
  const [result] = await db.query(
    "DELETE FROM reposts WHERE id = ? AND user_id = ?",
    [repostId, userId],
  );
  return result.affectedRows > 0;
}

module.exports = { createRepost, getRepostsByUser, deleteRepost };
