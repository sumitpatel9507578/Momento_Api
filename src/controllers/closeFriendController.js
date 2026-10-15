const db = require("../config/db");

function userIdFrom(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function list(req, res) {
  const userId = userIdFrom(req.user?.id);
  if (!userId) return res.status(401).json({ success: false, message: "Invalid authenticated user" });
  try {
    const [columns] = await db.query("SHOW COLUMNS FROM users");
    const names = columns.map((column) => column.Field);
    const nameColumn = names.includes("full_name") ? "full_name" : names.includes("name") ? "name" : null;
    const imageColumn = names.includes("profile_image") ? "profile_image" : names.includes("profileImage") ? "profileImage" : null;
    const nameSelect = nameColumn ? `u.${nameColumn}` : "''";
    const imageSelect = imageColumn ? `u.${imageColumn}` : "''";
    const [rows] = await db.query(
      `SELECT u.id, u.username, ${nameSelect} AS name,
              ${imageSelect} AS profileImage
       FROM close_friends cf JOIN users u ON u.id = cf.friend_id
       WHERE cf.user_id = ? ORDER BY cf.created_at DESC`,
      [userId],
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List close friends error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch close friends" });
  }
}

async function update(req, res, add) {
  const ownerId = userIdFrom(req.user?.id);
  const friendId = userIdFrom(req.params.userId);
  if (!ownerId) return res.status(401).json({ success: false, message: "Invalid authenticated user" });
  if (!friendId || ownerId === friendId) return res.status(400).json({ success: false, message: "A different valid userId is required" });
  try {
    if (add) {
      const [users] = await db.query("SELECT id FROM users WHERE id = ?", [friendId]);
      if (!users.length) return res.status(404).json({ success: false, message: "User not found" });
      await db.query(
        "INSERT INTO close_friends (user_id, friend_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at = created_at",
        [ownerId, friendId],
      );
    } else {
      await db.query("DELETE FROM close_friends WHERE user_id = ? AND friend_id = ?", [ownerId, friendId]);
    }
    return res.status(200).json({ success: true, data: { userId: friendId, isCloseFriend: add } });
  } catch (error) {
    console.error(`${add ? "Add" : "Remove"} close friend error:`, error);
    return res.status(500).json({ success: false, message: "Failed to update close friends" });
  }
}

module.exports = {
  list,
  add: (req, res) => update(req, res, true),
  remove: (req, res) => update(req, res, false),
};
