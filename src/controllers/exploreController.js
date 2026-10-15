const db = require("../config/db");

async function getExplore(req, res) {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  try {
    const [[postColumns], [reelColumns], [userColumns], [likeColumns]] = await Promise.all([
      db.query("SHOW COLUMNS FROM posts"),
      db.query("SHOW COLUMNS FROM reels"),
      db.query("SHOW COLUMNS FROM users"),
      db.query("SHOW COLUMNS FROM likes"),
    ]);
    const posts = new Set(postColumns.map((column) => column.Field));
    const reels = new Set(reelColumns.map((column) => column.Field));
    const users = new Set(userColumns.map((column) => column.Field));
    const likes = new Set(likeColumns.map((column) => column.Field));
    const postOwner = posts.has("user_id") ? "user_id" : "userId";
    const postUrl = posts.has("media_url") ? "media_url" : "mediaUrl";
    const postType = posts.has("media_type") ? "media_type" : "mediaType";
    const imageCol = users.has("profile_image")
      ? `u.profile_image`
      : users.has("profileImage")
        ? `u.profileImage`
        : "''";
    const postLikeCount = likes.has("post_id")
      ? "(SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)"
      : "0";
    const reelLikeCount = likes.has("reel_id")
      ? "(SELECT COUNT(*) FROM likes l WHERE l.reel_id = r.id)"
      : "0";
    const [rows] = await db.query(
      `SELECT contentType, id, userId, username, profileImage, caption,
              mediaUrl, mediaType, createdAt, likesCount
       FROM (
         SELECT 'post' AS contentType, p.id, p.${postOwner} AS userId, u.username,
                ${imageCol} AS profileImage,
                p.caption, p.${postUrl} AS mediaUrl,
                p.${postType} AS mediaType,
                p.created_at AS createdAt,
                ${postLikeCount} AS likesCount
         FROM posts p JOIN users u ON u.id = p.${postOwner}
         UNION ALL
         SELECT 'reel', r.id, r.user_id, u.username,
                ${imageCol},
                r.caption, r.video_url, 'video', r.created_at,
                ${reelLikeCount}
         FROM reels r JOIN users u ON u.id = r.user_id
       ) discover
       ORDER BY likesCount DESC, createdAt DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Explore feed error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch explore feed" });
  }
}

module.exports = { getExplore };
