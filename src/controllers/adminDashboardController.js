const db = require("../config/db");

function dateRange(req) {
  const from = String(req.query.from || req.query.startDate || "");
  const to = String(req.query.to || req.query.endDate || "");
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  return { from: valid(from) ? from : null, to: valid(to) ? to : null };
}

async function tableExists(table) {
  const [rows] = await db.query(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [table],
  );
  return Number(rows[0]?.total || 0) > 0;
}

async function overview(req, res) {
  try {
    const [users] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN COALESCE(is_blocked,0)=0 AND COALESCE(is_active,1)=1 AND status <> 'blocked' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN COALESCE(is_blocked,0)=1 OR COALESCE(is_active,1)=0 OR status='blocked' THEN 1 ELSE 0 END) AS blocked
       FROM users`,
    );
    const [posts] = await db.query("SELECT COUNT(*) AS total FROM posts");
    const [reels] = await db.query("SELECT COUNT(*) AS total FROM reels");
    return res.json({ success: true, data: {
      totalUsers: Number(users[0].total), totalActiveUsers: Number(users[0].active || 0),
      totalBlockedUsers: Number(users[0].blocked || 0), totalPosts: Number(posts[0].total),
      totalReels: Number(reels[0].total),
    } });
  } catch (error) {
    console.error("Admin overview error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch dashboard overview" });
  }
}

async function growth(req, res) {
  const { from, to } = dateRange(req);
  const range = [];
  const params = [];
  if (from) { range.push("DATE(created_at) >= ?"); params.push(from); }
  if (to) { range.push("DATE(created_at) <= ?"); params.push(to); }
  const where = range.length ? `WHERE ${range.join(" AND ")}` : "";
  try {
    const [users] = await db.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS total FROM users ${where} GROUP BY DATE(created_at) ORDER BY date DESC`,
      params,
    );
    const contentRange = [];
    const contentParams = [];
    if (from) { contentRange.push("DATE(created_at) >= ?"); contentParams.push(from); }
    if (to) { contentRange.push("DATE(created_at) <= ?"); contentParams.push(to); }
    const contentWhere = contentRange.length ? `WHERE ${contentRange.join(" AND ")}` : "";
    const [content] = await db.query(
      `SELECT date, SUM(posts) AS posts, SUM(reels) AS reels FROM (
         SELECT DATE(created_at) AS date, COUNT(*) AS posts, 0 AS reels FROM posts
         ${contentWhere} GROUP BY DATE(created_at)
         UNION ALL
         SELECT DATE(created_at) AS date, 0 AS posts, COUNT(*) AS reels FROM reels
         ${contentWhere} GROUP BY DATE(created_at)
       ) daily GROUP BY date ORDER BY date DESC`,
      [...contentParams, ...contentParams],
    );
    const [followers] = await db.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS total FROM follows
       ${from || to ? "WHERE " + range.map((clause) => clause.replace("created_at", "created_at")).join(" AND ") : ""}
       GROUP BY DATE(created_at) ORDER BY date DESC`,
      params,
    );
    return res.json({ success: true, data: { newUsers: users, content: content, newFollowers: followers } });
  } catch (error) {
    console.error("Admin growth error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch growth statistics" });
  }
}

async function engagement(req, res) {
  const hasViews = await tableExists("content_views");
  let reach = [];
  let engagement = { totalInteractions: 0, reach: 0, engagementRate: 0, reachAvailable: false };
  try {
    if (hasViews) {
      const [reachRows] = await db.query(
        "SELECT DATE(created_at) AS date, COUNT(*) AS views FROM content_views GROUP BY DATE(created_at) ORDER BY date DESC",
      );
      reach = reachRows;
      const [viewCount] = await db.query("SELECT COUNT(*) AS total FROM content_views");
      const [interactionCount] = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM likes) +
           (SELECT COUNT(*) FROM comments) AS total`,
      );
      const views = Number(viewCount[0].total);
      const interactions = Number(interactionCount[0].total);
      engagement = {
        totalInteractions: interactions, reach: views,
        engagementRate: views ? Number(((interactions / views) * 100).toFixed(2)) : 0,
        reachAvailable: views > 0 || reachRows.length > 0,
      };
    }
    return res.json({ success: true, data: { dailyReach: reach, engagement } });
  } catch (error) {
    console.error("Admin engagement error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch engagement statistics" });
  }
}

async function trending(req, res) {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 5, 1), 20);
  const [posts] = await db.query(
    `SELECT p.id, p.caption, COUNT(DISTINCT l.id) + COUNT(DISTINCT c.id) AS score
     FROM posts p LEFT JOIN likes l ON l.post_id = p.id LEFT JOIN comments c ON c.post_id = p.id
     GROUP BY p.id ORDER BY score DESC, p.id DESC LIMIT ?`,
    [limit],
  );
  const [reels] = await db.query(
    `SELECT r.id, r.caption, COUNT(DISTINCT l.id) + COUNT(DISTINCT c.id) AS score
     FROM reels r LEFT JOIN likes l ON l.reel_id = r.id LEFT JOIN comments c ON c.reel_id = r.id
     GROUP BY r.id ORDER BY score DESC, r.id DESC LIMIT ?`,
    [limit],
  );
  return res.json({ success: true, data: { posts, reels } });
}

async function exportData(req, res, format) {
  const [postRows] = await db.query(
    "SELECT COUNT(*) AS posts FROM posts UNION ALL SELECT 0 FROM DUAL",
  ).catch(() => [[{ posts: 0 }]]);
  const [rows] = await db.query(
    `SELECT 'users' AS metric, COUNT(*) AS value FROM users
     UNION ALL SELECT 'posts', COUNT(*) FROM posts
     UNION ALL SELECT 'reels', COUNT(*) FROM reels`,
  );
  if (format === "csv") {
    const csv = ["metric,value", ...rows.map((row) => `${row.metric},${row.value}`)].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"momento-analytics.csv\"");
    return res.send(csv);
  }
  const lines = rows.map((row) => `${row.metric}: ${row.value}`);
  const content = lines.join("\n");
  const escaped = content.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${escaped.length + 49} >>\nstream\nBT /F1 12 Tf 72 720 Td 14 TL (${escaped.replaceAll("\n", ") Tj T* (")}) Tj ET\nendstream\nendobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object) => { offsets.push(Buffer.byteLength(pdf, "binary")); pdf += object; });
  const xref = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let index = 1; index <= 5; index++) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=\"momento-analytics.pdf\"");
  return res.send(Buffer.from(pdf, "binary"));
}

module.exports = { overview, growth, engagement, trending, exportData };
