const db = require("../config/db");

const positiveId = (value) => /^[1-9]\d*$/.test(String(value || ""));
const pagination = (req) => ({
  page: Math.min(Math.max(Number.parseInt(req.query.page, 10) || 1, 1), 1000000),
  limit: Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100),
});

async function audit(adminId, action, targetType, targetId, details = null) {
  try {
    await db.query(
      `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [adminId, action, targetType, String(targetId), details ? JSON.stringify(details) : null],
    );
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
  }
}

async function listUsers(req, res) {
  try {
    const { page, limit } = pagination(req);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const role = String(req.query.role || "").trim().toLowerCase();
    const where = [];
    const params = [];
    if (search) {
      where.push("(username LIKE ? OR full_name LIKE ? OR email LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status === "blocked") where.push("(is_blocked = 1 OR status = 'blocked' OR is_active = 0)");
    if (status === "active") where.push("(is_blocked = 0 AND status <> 'blocked' AND is_active = 1)");
    if (role === "admin" || role === "user") { where.push("role = ?"); params.push(role); }
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await db.query(
      `SELECT id, username, full_name, email, profileImage, bio,
              COALESCE(is_blocked, 0) AS is_blocked,
              COALESCE(status, CASE WHEN COALESCE(is_blocked, 0)=1 THEN 'blocked' ELSE 'active' END) AS status,
              COALESCE(is_verified, 0) AS is_verified, COALESCE(role, 'user') AS role, created_at
       FROM users ${sqlWhere}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM users ${sqlWhere}`, params);
    const total = Number(countRows[0]?.total || 0);
    return res.json({ success: true, data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Admin list users error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
}

async function getUser(req, res) {
  if (!positiveId(req.params.id)) return res.status(400).json({ success: false, message: "A valid user ID is required" });
  try {
    const [rows] = await db.query(
      `SELECT id, username, full_name, email, bio, profileImage,
              COALESCE(is_blocked, 0) AS is_blocked,
              COALESCE(status, CASE WHEN COALESCE(is_blocked, 0)=1 THEN 'blocked' ELSE 'active' END) AS status,
              COALESCE(is_verified, 0) AS is_verified, COALESCE(role, 'user') AS role, created_at
       FROM users WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: "User not found" });
    const [counts] = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts,
         (SELECT COUNT(*) FROM reels WHERE user_id = ?) AS reels,
         (SELECT COUNT(*) FROM follows WHERE following_id = ?) AS followers,
         (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following`,
      [req.params.id, req.params.id, req.params.id, req.params.id],
    );
    const user = rows[0];
    return res.json({ success: true, data: {
      id: user.id, fullName: user.full_name || "", username: user.username, email: user.email, bio: user.bio || "",
      profilePicture: user.profileImage || "", posts: Number(counts[0].posts),
      reels: Number(counts[0].reels), followers: Number(counts[0].followers), following: Number(counts[0].following),
      accountCreatedAt: user.created_at, status: user.status, verificationStatus: Boolean(Number(user.is_verified)),
      isVerified: Boolean(Number(user.is_verified)), role: user.role || "user",
    } });
  } catch (error) {
    console.error("Admin get user error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch user" });
  }
}

async function setBlocked(req, res, blocked) {
  const id = req.params.id;
  if (!positiveId(id)) return res.status(400).json({ success: false, message: "A valid user ID is required" });
  try {
    await db.query(
      "UPDATE users SET is_blocked = ?, status = ?, is_active = ? WHERE id = ?",
      [blocked ? 1 : 0, blocked ? "blocked" : "active", blocked ? 0 : 1, id],
    );
    await audit(req.admin?.id || req.user.id, blocked ? "block_user" : "unblock_user", "user", id);
    return res.json({ success: true, message: blocked ? "User blocked successfully" : "User unblocked successfully", data: { id: Number(id), status: blocked ? "blocked" : "active" } });
  } catch (error) {
    console.error("Admin block user error:", error);
    return res.status(500).json({ success: false, message: "Failed to update user status" });
  }
}

async function setVerified(req, res, verified) {
  const id = req.params.id;
  if (!positiveId(id)) return res.status(400).json({ success: false, message: "A valid user ID is required" });
  await db.query("UPDATE users SET is_verified = ? WHERE id = ?", [verified ? 1 : 0, id]);
  await audit(req.admin?.id || req.user.id, verified ? "verify_user" : "remove_verification", "user", id);
  return res.json({ success: true, message: verified ? "User verified successfully" : "Verification removed successfully", data: { id: Number(id), isVerified: verified } });
}

async function setRole(req, res) {
  const id = req.params.id;
  const role = String(req.body?.role || req.params.role || "").toLower();
  if (!positiveId(id) || !["user", "admin"].includes(role)) {
    return res.status(400).json({ success: false, message: "A valid user ID and role are required" });
  }
  const [rows] = await db.query("SELECT id, role FROM users WHERE id = ? LIMIT 1", [id]);
  if (!rows[0]) return res.status(404).json({ success: false, message: "User not found" });
  const sameAdmin = String(req.user.id) === String(id) && String(rows[0].role || "").toLower() === "admin";
  if (sameAdmin && role === "user") {
    const [adminRows] = await db.query("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'");
    if (Number(adminRows[0].total) <= 1) return res.status(409).json({ success: false, message: "The last administrator cannot remove their own privileges" });
  }
  await db.query("UPDATE users SET role = ? WHERE id = ?", [role, id]);
  await audit(req.admin?.id || req.user.id, role === "admin" ? "promote_admin" : "demote_admin", "user", id);
  return res.json({ success: true, message: role === "admin" ? "User promoted to admin" : "Admin privileges removed", data: { id: Number(id), role } });
}

async function deleteUser(req, res) {
  const id = req.params.id;
  if (!positiveId(id)) return res.status(400).json({ success: false, message: "A valid user ID is required" });
  if (String(req.user.id) === String(id)) return res.status(409).json({ success: false, message: "Administrators cannot delete their own account" });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [id]);
    if (!rows[0]) { await connection.rollback(); return res.status(404).json({ success: false, message: "User not found" }); }
    for (const table of ["likes", "comments", "reposts", "saved_posts", "saved_reels", "notifications", "messages", "follows", "close_friends"]) {
      try {
        await connection.query(`DELETE FROM ${table} WHERE user_id = ? OR follower_id = ? OR following_id = ? OR sender_id = ? OR receiver_id = ? OR friend_id = ?`, [id, id, id, id, id, id]);
      } catch (error) {
        if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error.code)) throw error;
      }
    }
    await connection.query("DELETE FROM posts WHERE user_id = ?", [id]);
    await connection.query("DELETE FROM reels WHERE user_id = ?", [id]);
    await connection.query("DELETE FROM users WHERE id = ?", [id]);
    await connection.commit();
    await audit(req.admin?.id || req.user.id, "delete_user", "user", id);
    return res.json({ success: true, message: "User account deleted permanently" });
  } catch (error) {
    await connection.rollback();
    console.error("Admin delete user error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete user account" });
  } finally {
    connection.release();
  }
}

module.exports = { listUsers, getUser, setBlocked, setVerified, setRole, deleteUser };
