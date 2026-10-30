const db = require("../config/db");

async function trackContentView(contentType, contentId, viewerId) {
  try {
    await db.query(
      `INSERT INTO content_views (content_type, content_id, viewer_id)
       VALUES (?, ?, ?)`,
      [contentType, contentId, viewerId || null],
    );
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") {
      console.error("Content view tracking error:", error.message);
    }
  }
}

module.exports = { trackContentView };
