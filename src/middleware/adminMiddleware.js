const db = require("../config/db");

function isValidId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0;
  }
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) {
    return false;
  }
  return BigInt(value) <= 9223372036854775807n;
}

async function adminMiddleware(req, res, next) {
  const userId = req.user?.id;
  if (
    String(userId) === "momentz-static-admin" &&
    String(req.user?.role || "").toLowerCase() === "admin"
  ) {
    req.admin = { id: userId };
    return next();
  }

  if (!isValidId(userId)) {
    return res.status(401).json({
      success: false,
      message: "Invalid authenticated user",
    });
  }

  try {
    const [rows] = await db.query(
      "SELECT id, role FROM users WHERE id = ?",
      [userId],
    );
    if (!rows[0]) {
      return res.status(401).json({
        success: false,
        message: "Authenticated account is not available",
      });
    }
    if (String(rows[0].role || "").toLowerCase() !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Administrator access required",
      });
    }
    req.admin = { id: rows[0].id };
    return next();
  } catch (error) {
    console.error("Administrator authorization error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify administrator access",
    });
  }
}

module.exports = adminMiddleware;
