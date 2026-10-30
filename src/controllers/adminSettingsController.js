const db = require("../config/db");

async function ensureSettingsTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS admin_settings (
       setting_key VARCHAR(100) PRIMARY KEY,
       setting_value JSON NOT NULL,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

async function getSettings(req, res) {
  try {
    await ensureSettingsTable();
    const [rows] = await db.query("SELECT setting_key, setting_value FROM admin_settings");
    const settings = {};
    for (const row of rows) {
      settings[row.setting_key] = typeof row.setting_value === "string"
        ? JSON.parse(row.setting_value)
        : row.setting_value;
    }
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Get admin settings error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch admin settings" });
  }
}

async function updateSettings(req, res) {
  const allowed = ["maintenanceMode", "allowUserRegistration", "reportAutoReview", "requirePostApproval"];
  const settings = req.body?.settings || req.body || {};
  const updates = Object.keys(settings).filter((key) => allowed.includes(key));
  if (!updates.length) return res.status(400).json({ success: false, message: "No supported settings provided" });
  try {
    await ensureSettingsTable();
    for (const key of updates) {
      if (typeof settings[key] !== "boolean") {
        return res.status(400).json({ success: false, message: `${key} must be a boolean` });
      }
      await db.query(
        `INSERT INTO admin_settings (setting_key, setting_value)
         VALUES (?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, JSON.stringify(settings[key])],
      );
    }
    return getSettings(req, res);
  } catch (error) {
    console.error("Update admin settings error:", error);
    return res.status(500).json({ success: false, message: "Failed to update admin settings" });
  }
}

async function health(req, res) {
  let databaseStatus = "connected";
  try {
    await db.query("SELECT 1");
  } catch (error) {
    databaseStatus = "disconnected";
  }
  return res.json({ success: true, data: {
    apiStatus: "healthy", databaseStatus,
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || "development",
    nodeVersion: process.version,
  } });
}

module.exports = { getSettings, updateSettings, health };
