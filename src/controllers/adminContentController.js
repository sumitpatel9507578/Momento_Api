const db = require("../config/db");
const cloudinary = require("../config/cloudinary");

const positiveId = (value) => /^[1-9]\d*$/.test(String(value || ""));
const pagination = (req) => ({
  page: Math.min(Math.max(Number.parseInt(req.query.page, 10) || 1, 1), 1000000),
  limit: Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100),
});

async function audit(req, action, targetId, details) {
  try {
    await db.query(
      `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)`,
      [req.admin?.id || req.user.id, action, action.includes("post") ? "post" : "reel", String(targetId), JSON.stringify(details || null)],
    );
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
  }
}

async function getPosts(req, res) {
  const { page, limit } = pagination(req);
  const offset = (page - 1) * limit;
  const search = String(req.query.search || req.query.caption || "").trim();
  const username = String(req.query.username || "").trim();
  const fullName = String(req.query.fullName || req.query.full_name || "").trim();
  const where = [];
  const params = [];
  if (search) { where.push("p.caption LIKE ?"); params.push(`%${search}%`); }
  if (username) { where.push("u.username LIKE ?"); params.push(`%${username}%`); }
  if (fullName) { where.push("u.full_name LIKE ?"); params.push(`%${fullName}%`); }
  const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT p.id, p.caption, p.media_url, p.created_at,
            u.id AS creator_id, u.username, u.full_name,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
     FROM posts p JOIN users u ON u.id = p.user_id
     ${sqlWhere} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [count] = await db.query(`SELECT COUNT(*) AS total FROM posts p JOIN users u ON u.id = p.user_id ${sqlWhere}`, params);
  const total = Number(count[0].total);
  return res.json({ success: true, data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

async function getPost(req, res) {
  if (!positiveId(req.params.id)) return res.status(400).json({ success: false, message: "A valid post ID is required" });
  const [rows] = await db.query(
    `SELECT p.id, p.caption, p.media_url, p.created_at,
            u.id AS creator_id, u.username, u.full_name,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
     FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? LIMIT 1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: "Post not found" });
  return res.json({ success: true, data: rows[0] });
}

async function deletePost(req, res) {
  const id = req.params.id;
  if (!positiveId(id)) return res.status(400).json({ success: false, message: "A valid post ID is required" });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT * FROM posts WHERE id = ? FOR UPDATE", [id]);
    if (!rows[0]) { await connection.rollback(); return res.status(404).json({ success: false, message: "Post not found" }); }
    const post = rows[0];
    for (const query of [
      "DELETE FROM likes WHERE post_id = ?",
      "DELETE FROM comments WHERE post_id = ?",
      "DELETE FROM saved_posts WHERE post_id = ?",
      "DELETE FROM reposts WHERE post_id = ?",
      "DELETE FROM reports WHERE post_id = ?",
    ]) {
      try { await connection.query(query, [id]); } catch (error) {
        if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error.code)) throw error;
      }
    }
    await connection.query("DELETE FROM posts WHERE id = ?", [id]);
    await connection.commit();
    await audit(req, "delete_post", id, null);
    const mediaUrl = post.media_url || post.mediaUrl;
    if (mediaUrl && mediaUrl.includes("cloudinary.com")) {
      try {
        const parts = mediaUrl.split("/upload/")[1]?.split("/");
        const file = parts?.slice(1).join("/") || "";
        const publicId = file.replace(/\.[^.]+$/, "");
        if (publicId) await cloudinary.uploader.destroy(publicId, { invalidate: true });
      } catch (error) { console.error("Cloudinary post cleanup failed:", error.message); }
    }
    return res.json({ success: true, message: "Post deleted successfully" });
  } catch (error) {
    await connection.rollback();
    console.error("Admin delete post error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete post" });
  } finally { connection.release(); }
}

async function getReels(req, res) {
  const { page, limit } = pagination(req);
  const offset = (page - 1) * limit;
  const search = String(req.query.search || req.query.caption || "").trim();
  const username = String(req.query.username || "").trim();
  const song = String(req.query.song || req.query.song_name || "").trim();
  const where = [];
  const params = [];
  if (search) { where.push("r.caption LIKE ?"); params.push(`%${search}%`); }
  if (username) { where.push("u.username LIKE ?"); params.push(`%${username}%`); }
  if (song) { where.push("r.song_name LIKE ?"); params.push(`%${song}%`); }
  const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT r.id, r.caption, r.video_url, NULL AS thumbnail_url, NULL AS cover_url, r.song_name, r.created_at,
            u.id AS creator_id, u.username, u.full_name,
            (SELECT COUNT(*) FROM likes l WHERE l.reel_id = r.id) AS likes_count,
            (SELECT COUNT(*) FROM comments c WHERE c.reel_id = r.id) AS comments_count
     FROM reels r JOIN users u ON u.id = r.user_id
     ${sqlWhere} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [count] = await db.query(`SELECT COUNT(*) AS total FROM reels r JOIN users u ON u.id = r.user_id ${sqlWhere}`, params);
  const total = Number(count[0].total);
  return res.json({ success: true, data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

async function getReel(req, res) {
  if (!positiveId(req.params.id)) return res.status(400).json({ success: false, message: "A valid reel ID is required" });
  const [rows] = await db.query(
    `SELECT r.*, u.id AS creator_id, u.username, u.full_name,
            (SELECT COUNT(*) FROM likes l WHERE l.reel_id = r.id) AS likes_count,
            (SELECT COUNT(*) FROM comments c WHERE c.reel_id = r.id) AS comments_count
     FROM reels r JOIN users u ON u.id = r.user_id WHERE r.id = ? LIMIT 1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: "Reel not found" });
  return res.json({ success: true, data: rows[0] });
}

async function deleteReel(req, res) {
  const id = req.params.id;
  if (!positiveId(id)) return res.status(400).json({ success: false, message: "A valid reel ID is required" });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT * FROM reels WHERE id = ? FOR UPDATE", [id]);
    if (!rows[0]) { await connection.rollback(); return res.status(404).json({ success: false, message: "Reel not found" }); }
    const reel = rows[0];
    for (const query of [
      "DELETE FROM likes WHERE reel_id = ?",
      "DELETE FROM comments WHERE reel_id = ?",
      "DELETE FROM saved_reels WHERE reel_id = ?",
      "DELETE FROM reposts WHERE reel_id = ?",
      "DELETE FROM reports WHERE reel_id = ?",
    ]) {
      try { await connection.query(query, [id]); } catch (error) {
        if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error.code)) throw error;
      }
    }
    await connection.query("DELETE FROM reels WHERE id = ?", [id]);
    await connection.commit();
    await audit(req, "delete_reel", id, null);
    if (reel.video_url && reel.video_url.includes("cloudinary.com")) {
      try {
        const file = reel.video_url.split("/upload/")[1]?.split("/").slice(1).join("/") || "";
        const publicId = file.replace(/\.[^.]+$/, "");
        if (publicId) await cloudinary.uploader.destroy(publicId, { resource_type: "video", invalidate: true });
      } catch (error) { console.error("Cloudinary reel cleanup failed:", error.message); }
    }
    return res.json({ success: true, message: "Reel deleted successfully" });
  } catch (error) {
    await connection.rollback();
    console.error("Admin delete reel error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete reel" });
  } finally { connection.release(); }
}

module.exports = { getPosts, getPost, deletePost, getReels, getReel, deleteReel };
