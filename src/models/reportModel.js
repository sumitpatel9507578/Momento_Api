const db = require("../config/db");

const TARGET_TYPES = new Set([
  "user",
  "post",
  "reel",
  "story",
  "comment",
  "message",
]);
const REPORT_STATUSES = new Set([
  "open",
  "under_review",
  "resolved",
  "dismissed",
]);
const STATUS_TRANSITIONS = {
  open: new Set(["under_review", "resolved", "dismissed"]),
  under_review: new Set(["open", "resolved", "dismissed"]),
  resolved: new Set(["open"]),
  dismissed: new Set(["open"]),
};

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function getTargetOwner(targetType, targetId, reporterId) {
  if (targetType === "user") {
    const [rows] = await db.query("SELECT id FROM users WHERE id = ?", [
      targetId,
    ]);
    return rows[0] ? { ownerId: rows[0].id } : null;
  }

  if (targetType === "message") {
    const [rows] = await db.query(
      `SELECT id, sender_id, receiver_id
       FROM messages
       WHERE id = ? AND (sender_id = ? OR receiver_id = ?)`,
      [targetId, reporterId, reporterId],
    );
    if (!rows[0]) return null;
    return { ownerId: rows[0].sender_id };
  }

  const targetTable = {
    post: "posts",
    reel: "reels",
    story: "stories",
    comment: "comments",
  }[targetType];
  const [rows] = await db.query(
    `SELECT id, user_id AS owner_id FROM ${targetTable} WHERE id = ?`,
    [targetId],
  );
  return rows[0] ? { ownerId: rows[0].owner_id } : null;
}

async function createReport({
  reporterId,
  targetType,
  targetId,
  reason,
  message,
}) {
  const [rateRows] = await db.query(
    `SELECT COUNT(*) AS report_count
     FROM reports
     WHERE reporter_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
    [reporterId],
  );
  if (Number(rateRows[0]?.report_count || 0) >= 5) {
    throw makeError(
      "REPORT_RATE_LIMITED",
      "You have submitted too many reports. Please try again later.",
    );
  }

  const target = await getTargetOwner(targetType, targetId, reporterId);
  if (!target) {
    throw makeError("REPORT_TARGET_NOT_FOUND", "Report target not found");
  }

  const reportedUserId = target.ownerId ?? null;
  if (
    reportedUserId !== null &&
    String(reportedUserId) === String(reporterId)
  ) {
    throw makeError("SELF_REPORT", "You cannot report your own account or content");
  }

  const [duplicates] = await db.query(
    `SELECT id FROM reports
     WHERE reporter_id = ? AND target_type = ? AND target_id = ?
       AND status IN ('open', 'under_review')
     LIMIT 1`,
    [reporterId, targetType, targetId],
  );
  if (duplicates.length) {
    throw makeError(
      "DUPLICATE_REPORT",
      "You have already submitted an active report for this target",
    );
  }

  const [result] = await db.query(
    `INSERT INTO reports
       (reporter_id, reported_user_id, target_type, target_id, reason, message, status)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`,
    [reporterId, reportedUserId, targetType, targetId, reason, message],
  );
  if (!result.insertId || result.affectedRows !== 1) {
    throw makeError("REPORT_INSERT_FAILED", "Report could not be saved");
  }
  return result.insertId;
}

const REPORT_SELECT = `
  SELECT r.id, r.reporter_id, r.reported_user_id, r.target_type, r.target_id,
         r.reason, r.message, r.status, r.admin_note, r.reviewed_by,
         r.reviewed_at, r.created_at, r.updated_at,
         reporter.username AS reporter_username,
         reporter.full_name AS reporter_name,
         reporter.profileImage AS reporter_profile_image,
         reported.username AS reported_username,
         reported.full_name AS reported_name,
         reported.profileImage AS reported_profile_image,
         reviewer.username AS reviewer_username
  FROM reports r
  LEFT JOIN users reporter ON reporter.id = r.reporter_id
  LEFT JOIN users reported ON reported.id = r.reported_user_id
  LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by`;

function buildReportFilters(filters) {
  const clauses = [];
  const values = [];
  if (filters.status) {
    clauses.push("r.status = ?");
    values.push(filters.status);
  }
  if (filters.targetType) {
    clauses.push("r.target_type = ?");
    values.push(filters.targetType);
  }
  if (filters.reason) {
    clauses.push("r.reason = ?");
    values.push(filters.reason);
  }
  if (filters.search) {
    const search = `%${filters.search}%`;
    const searchClauses = [
      "reporter.username LIKE ?",
      "reported.username LIKE ?",
    ];
    const searchValues = [search, search];
    if (/^\d+$/.test(filters.search)) {
      searchClauses.unshift(
        "r.id = ?",
        "r.reporter_id = ?",
        "r.reported_user_id = ?",
      );
      searchValues.unshift(
        filters.search,
        filters.search,
        filters.search,
      );
    }
    clauses.push(`(${searchClauses.join(" OR ")})`);
    values.push(...searchValues);
  }
  return {
    sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

async function listReports(filters) {
  const where = buildReportFilters(filters);
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users reported ON reported.id = r.reported_user_id
     LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by${where.sql}`,
    where.values,
  );
  const [rows] = await db.query(
    `${REPORT_SELECT}${where.sql}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ? OFFSET ?`,
    [...where.values, filters.limit, filters.offset],
  );
  return { reports: rows, total: Number(countRows[0]?.total || 0) };
}

async function getReportById(reportId) {
  const [rows] = await db.query(`${REPORT_SELECT} WHERE r.id = ? LIMIT 1`, [
    reportId,
  ]);
  return rows[0] || null;
}

async function getReportedTarget(targetType, targetId) {
  const queries = {
    user: [
      `SELECT id, username, full_name AS name, profileImage AS profile_image,
              bio, created_at
       FROM users WHERE id = ?`,
      [targetId],
    ],
    post: [
      `SELECT id, user_id, caption, media_url, media_type, created_at
       FROM posts WHERE id = ?`,
      [targetId],
    ],
    reel: [
      `SELECT id, user_id, caption, video_url AS media_url, song_name, created_at
       FROM reels WHERE id = ?`,
      [targetId],
    ],
    story: [
      `SELECT id, user_id, caption, media_url, media_type, expires_at, created_at
       FROM stories WHERE id = ?`,
      [targetId],
    ],
    comment: [
      `SELECT id, user_id, post_id, reel_id, comment, created_at
       FROM comments WHERE id = ?`,
      [targetId],
    ],
    message: [
      `SELECT id, sender_id, receiver_id, message, message_type, media_url,
              reel_id, post_id, created_at
       FROM messages WHERE id = ?`,
      [targetId],
    ],
  };
  const [rows] = await db.query(...queries[targetType]);
  return rows[0] || null;
}

async function getReviewHistory(reportId) {
  const [rows] = await db.query(
    `SELECT h.id, h.previous_status, h.new_status, h.admin_id, h.admin_note,
            h.created_at, u.username AS admin_username
     FROM report_review_history h
     LEFT JOIN users u ON u.id = h.admin_id
     WHERE h.report_id = ?
     ORDER BY h.created_at ASC, h.id ASC`,
    [reportId],
  );
  return rows;
}

async function updateReportStatus({
  reportId,
  status,
  adminId,
  adminNote,
}) {
  const connection = await db.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.query(
      `SELECT id, status, admin_note FROM reports WHERE id = ? FOR UPDATE`,
      [reportId],
    );
    const report = rows[0];
    if (!report) {
      await connection.rollback();
      transactionStarted = false;
      return null;
    }
    if (!REPORT_STATUSES.has(report.status)) {
      throw makeError("INVALID_CURRENT_REPORT_STATUS", "Report has an invalid current status");
    }
    if (!STATUS_TRANSITIONS[report.status]?.has(status)) {
      throw makeError(
        "INVALID_REPORT_TRANSITION",
        `A report cannot transition from ${report.status} to ${status}`,
      );
    }

    const savedAdminNote =
      adminNote === undefined ? report.admin_note : adminNote;
    await connection.query(
      `UPDATE reports
       SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ?`,
      [status, savedAdminNote, adminId, reportId],
    );
    await connection.query(
      `INSERT INTO report_review_history
         (report_id, previous_status, new_status, admin_id, admin_note)
       VALUES (?, ?, ?, ?, ?)`,
      [reportId, report.status, status, adminId, savedAdminNote],
    );
    await connection.commit();
    transactionStarted = false;
    return {
      id: reportId,
      previousStatus: report.status,
      status,
      reviewedBy: adminId,
      adminNote: savedAdminNote,
    };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  TARGET_TYPES,
  REPORT_STATUSES,
  createReport,
  listReports,
  getReportById,
  getReportedTarget,
  getReviewHistory,
  updateReportStatus,
};
