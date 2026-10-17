const db = require("../config/db");
const notificationModel = require("../models/notificationModel");
const postModel = require("../models/postModel");

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function getCommentUserColumn() {
  const [columns] = await db.query("SHOW COLUMNS FROM comments");
  const names = columns.map((column) => column.Field);
  if (names.includes("user_id")) return "user_id";
  if (names.includes("userId")) return "userId";
  throw new Error("Comments table is missing its user ID column");
}

async function toggleLike(req, res) {
  const commentId = parseId(req.params.commentId);
  const userId = parseId(req.user?.id);
  if (!commentId || !userId) {
    return res.status(400).json({ success: false, message: "Valid comment and user IDs are required" });
  }
  try {
    const [comments] = await db.query("SELECT id FROM comments WHERE id = ?", [commentId]);
    if (!comments.length) return res.status(404).json({ success: false, message: "Comment not found" });
    const [existing] = await db.query(
      "SELECT comment_id FROM comment_likes WHERE comment_id = ? AND user_id = ?",
      [commentId, userId],
    );
    if (existing.length) {
      await db.query("DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?", [commentId, userId]);
      return res.json({ success: true, data: { isLiked: false } });
    }
    try {
      await db.query("INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)", [commentId, userId]);
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") throw error;
    }
    const userColumn = await getCommentUserColumn();
    const [ownerRows] = await db.query(
      `SELECT ${userColumn} AS userId FROM comments WHERE id = ?`,
      [commentId],
    );
    await notificationModel.createNotification(
      ownerRows[0]?.userId,
      userId,
      "like",
      "comment",
      commentId,
    );
    return res.json({ success: true, data: { isLiked: true } });
  } catch (error) {
    console.error("Toggle comment like error:", error);
    return res.status(500).json({ success: false, message: "Failed to update comment like" });
  }
}

async function pinComment(req, res) {
  const commentId = parseId(req.params.commentId);
  const userId = parseId(req.user?.id);
  if (!commentId || !userId) {
    return res.status(400).json({ success: false, message: "Valid comment and user IDs are required" });
  }
  try {
    await postModel.pinComment(commentId, userId);
    return res.json({ success: true, message: "Comment pinned successfully" });
  } catch (error) {
    console.error("Pin comment error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to pin comment" });
  }
}

async function getReplies(req, res) {
  const commentId = parseId(req.params.commentId);
  const viewerId = parseId(req.user?.id);
  if (!commentId) {
    return res.status(400).json({ success: false, message: "Valid comment ID is required" });
  }
  try {
    const replies = await postModel.getRepliesByCommentId(commentId, viewerId);
    return res.json({ success: true, data: replies });
  } catch (error) {
    console.error("Get replies error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch replies", data: [] });
  }
}

async function updateComment(req, res) {
  const commentId = parseId(req.params.commentId);
  const userId = parseId(req.user?.id);
  const text = req.body?.comment;
  if (!commentId || !userId || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ success: false, message: "A valid comment ID and comment text are required" });
  }
  try {
    const userColumn = await getCommentUserColumn();
    const [result] = await db.query(
      `UPDATE comments SET comment = ? WHERE id = ? AND ${userColumn} = ?`,
      [text.trim(), commentId, userId],
    );
    if (!result.affectedRows) {
      const [rows] = await db.query("SELECT id FROM comments WHERE id = ?", [commentId]);
      return res.status(rows.length ? 403 : 404).json({
        success: false,
        message: rows.length ? "You can only edit your own comments" : "Comment not found",
      });
    }
    return res.json({ success: true, data: { id: commentId, comment: text.trim() } });
  } catch (error) {
    console.error("Update comment error:", error);
    return res.status(500).json({ success: false, message: "Failed to update comment" });
  }
}

async function deleteComment(req, res) {
  const commentId = parseId(req.params.commentId);
  const userId = parseId(req.user?.id);
  if (!commentId || !userId) return res.status(400).json({ success: false, message: "Valid comment and user IDs are required" });
  try {
    const userColumn = await getCommentUserColumn();
    const [result] = await db.query(
      `DELETE FROM comments WHERE id = ? AND ${userColumn} = ?`,
      [commentId, userId],
    );
    if (!result.affectedRows) {
      const [rows] = await db.query("SELECT id FROM comments WHERE id = ?", [commentId]);
      return res.status(rows.length ? 403 : 404).json({
        success: false,
        message: rows.length ? "You can only delete your own comments" : "Comment not found",
      });
    }
    return res.json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Delete comment error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete comment" });
  }
}

module.exports = { toggleLike, pinComment, getReplies, updateComment, deleteComment };
