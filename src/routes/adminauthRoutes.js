const router = require("express").Router();
const { login } = require("../controllers/adminauthController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const db = require("../config/db");

router.post("/login", login);

async function setUserBlockState(req, res, blocked) {
  const userId = req.params.id;

  if (!/^[1-9]\d*$/.test(String(userId))) {
    return res.status(400).json({
      success: false,
      message: "Invalid user ID",
    });
  }

  try {
    const [users] = await db.query(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
      [userId],
    );
    if (!users[0]) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const [columns] = await db.query("SHOW COLUMNS FROM users");
    const availableColumns = new Set(columns.map((column) => column.Field));
    const updates = [];
    const values = [];

    const blockedColumn = availableColumns.has("is_blocked")
      ? "is_blocked"
      : availableColumns.has("isBlocked")
        ? "isBlocked"
        : null;
    if (blockedColumn) {
      updates.push(`${blockedColumn} = ?`);
      values.push(blocked ? 1 : 0);
    }
    if (availableColumns.has("status")) {
      updates.push("status = ?");
      values.push(blocked ? "blocked" : "active");
    }

    if (updates.length === 0) {
      return res.status(500).json({
        success: false,
        message: "User block columns are missing. Run the user blocking migration.",
      });
    }

    values.push(userId);
    await db.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
      values,
    );

    return res.json({
      success: true,
      message: blocked
        ? "User blocked successfully by Admin"
        : "User unblocked successfully by Admin",
    });
  } catch (error) {
    console.error("Admin user block update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update user block status",
    });
  }
}

router.post(
  "/users/:id/block",
  authMiddleware,
  adminMiddleware,
  (req, res) => setUserBlockState(req, res, true),
);

router.post(
  "/users/:id/unblock",
  authMiddleware,
  adminMiddleware,
  (req, res) => setUserBlockState(req, res, false),
);

module.exports = router;
