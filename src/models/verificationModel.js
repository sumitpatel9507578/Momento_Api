const db = require("../config/db");
const cloudinary = require("../config/cloudinary");

const APPLICATION_STATUSES = new Set([
  "submitted",
  "under_review",
  "approved",
  "rejected",
]);

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function getUserColumns() {
  const [rows] = await db.query("SHOW COLUMNS FROM users");
  return new Set(rows.map((column) => column.Field));
}

async function getEligibility(userId) {
  const columns = await getUserColumns();
  const nameColumn = columns.has("full_name")
    ? "full_name"
    : columns.has("name")
      ? "name"
      : null;
  const imageColumn = columns.has("profile_image")
    ? "profile_image"
    : columns.has("profileImage")
      ? "profileImage"
      : null;
  const nameExpression = nameColumn
    ? `NULLIF(TRIM(u.${nameColumn}), '')`
    : "NULL";
  const imageExpression = imageColumn
    ? `NULLIF(TRIM(u.${imageColumn}), '')`
    : "NULL";

  const [rows] = await db.query(
    `SELECT u.id, u.username, u.bio, u.created_at, u.is_verified,
            ${nameExpression} AS full_name, ${imageExpression} AS profile_image,
            (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS followers_count
     FROM users u
     WHERE u.id = ?`,
    [userId],
  );
  const user = rows[0];
  if (!user) return null;

  const followersCount = Number(user.followers_count || 0);
  const accountAgeDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000),
  );
  const profileComplete = Boolean(
    user.username &&
      user.full_name &&
      user.profile_image &&
      String(user.bio || "").trim(),
  );
  return {
    eligible:
      followersCount >= 5000 && accountAgeDays >= 90 && profileComplete,
    requirements: {
      followers: { required: 5000, current: followersCount, met: followersCount >= 5000 },
      accountAgeDays: { required: 90, current: accountAgeDays, met: accountAgeDays >= 90 },
      profileComplete: { required: true, current: profileComplete, met: profileComplete },
    },
    isVerified: Boolean(user.is_verified),
  };
}

async function getLatestApplication(userId) {
  const [rows] = await db.query(
    `SELECT id, status
     FROM verification_applications
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

async function createApplication({ userId, applicationData, document }) {
  const connection = await db.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [userRows] = await connection.query(
      "SELECT is_verified FROM users WHERE id = ? FOR UPDATE",
      [userId],
    );
    if (!userRows[0]) throw makeError("USER_NOT_FOUND", "User not found");
    if (userRows[0].is_verified) {
      throw makeError("ALREADY_VERIFIED", "This account is already verified");
    }

    const [applications] = await connection.query(
      `SELECT id, status FROM verification_applications
       WHERE user_id = ? AND status IN ('submitted', 'under_review')
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [userId],
    );
    if (applications.length) {
      throw makeError(
        "APPLICATION_IN_PROGRESS",
        "A verification application is already in progress",
      );
    }

    const [result] = await connection.query(
      `INSERT INTO verification_applications
         (user_id, status, application_data, document_public_id,
          document_resource_type, document_format)
       VALUES (?, 'submitted', ?, ?, ?, ?)`,
      [
        userId,
        JSON.stringify(applicationData),
        document.publicId,
        document.resourceType,
        document.format,
      ],
    );
    await connection.commit();
    transactionStarted = false;
    return result.insertId;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getApplicationStatus(userId) {
  const [rows] = await db.query(
    `SELECT id, status, requested_details, resubmit_requested,
            created_at, updated_at
     FROM verification_applications
     WHERE user_id = ?
     ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

async function resubmitApplication({ userId, applicationData, document }) {
  const connection = await db.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.query(
      `SELECT id, application_data FROM verification_applications
       WHERE user_id = ? AND status = 'under_review' AND resubmit_requested = 1
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [userId],
    );
    if (!rows[0]) {
      throw makeError(
        "RESUBMISSION_NOT_REQUESTED",
        "There is no verification application awaiting resubmission",
      );
    }

    const previousData =
      typeof rows[0].application_data === "string"
        ? JSON.parse(rows[0].application_data)
        : rows[0].application_data;
    const mergedApplicationData = {
      ...(previousData && typeof previousData === "object" ? previousData : {}),
      ...applicationData,
    };
    const [result] = await connection.query(
      `UPDATE verification_applications
       SET application_data = ?,
           document_public_id = COALESCE(?, document_public_id),
           document_resource_type = COALESCE(?, document_resource_type),
           document_format = COALESCE(?, document_format),
           status = 'submitted', resubmit_requested = 0, requested_details = NULL
       WHERE id = ?`,
      [
        JSON.stringify(mergedApplicationData),
        document?.publicId || null,
        document?.resourceType || null,
        document?.format || null,
        rows[0].id,
      ],
    );
    if (result.affectedRows !== 1) {
      throw makeError("RESUBMISSION_FAILED", "Application could not be resubmitted");
    }
    await connection.commit();
    transactionStarted = false;
    return rows[0].id;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function signedDocumentUrl(application) {
  if (!application.document_public_id) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + 900;
  return cloudinary.utils.private_download_url(
    application.document_public_id,
    application.document_format,
    {
      resource_type: application.document_resource_type,
      type: "authenticated",
      expires_at: expiresAt,
    },
  );
}

async function getStats() {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(status IN ('submitted', 'under_review')) AS pending,
            SUM(status = 'approved') AS approved,
            SUM(status = 'rejected') AS rejected
     FROM verification_applications`,
  );
  const stats = rows[0] || {};
  return {
    total: Number(stats.total || 0),
    pending: Number(stats.pending || 0),
    approved: Number(stats.approved || 0),
    rejected: Number(stats.rejected || 0),
  };
}

async function listApplications({ status, search, limit, offset }) {
  const columns = await getUserColumns();
  const nameColumn = columns.has("full_name")
    ? "full_name"
    : columns.has("name")
      ? "name"
      : null;
  const nameExpression = nameColumn ? `u.${nameColumn}` : "''";
  const conditions = [];
  const values = [];
  if (status) {
    conditions.push("a.status = ?");
    values.push(status);
  }
  if (search) {
    conditions.push(
      `(u.username LIKE ? OR u.email LIKE ? OR ${nameExpression} LIKE ? OR CAST(a.user_id AS CHAR) = ?)`,
    );
    values.push(`%${search}%`, `%${search}%`, `%${search}%`, search);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM verification_applications a
     JOIN users u ON u.id = a.user_id ${where}`,
    values,
  );
  const [rows] = await db.query(
    `SELECT a.id, a.user_id, a.status, a.application_data, a.requested_details,
            a.resubmit_requested, a.document_public_id, a.document_resource_type,
            a.document_format, a.created_at, a.updated_at,
            u.username, u.email, ${nameExpression} AS full_name, u.is_verified
     FROM verification_applications a
     JOIN users u ON u.id = a.user_id ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return {
    applications: rows.map((application) => ({
      ...application,
      document_url: signedDocumentUrl(application),
    })),
    total: Number(countRows[0]?.total || 0),
  };
}

async function reviewApplication({ applicationId, action, adminId, note }) {
  const connection = await db.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.query(
      `SELECT id, user_id, status FROM verification_applications
       WHERE id = ? FOR UPDATE`,
      [applicationId],
    );
    const application = rows[0];
    if (!application) {
      await connection.rollback();
      transactionStarted = false;
      return null;
    }

    if (
      action === "approve" &&
      !["submitted", "under_review"].includes(application.status)
    ) {
      throw makeError("INVALID_APPLICATION_TRANSITION", "Only pending applications can be approved");
    }
    if (
      action === "reject" &&
      !["submitted", "under_review"].includes(application.status)
    ) {
      throw makeError("INVALID_APPLICATION_TRANSITION", "Only pending applications can be rejected");
    }
    if (action === "request_info" && !["submitted", "under_review"].includes(application.status)) {
      throw makeError("INVALID_APPLICATION_TRANSITION", "Additional information can only be requested for pending applications");
    }
    if (action === "revoke" && application.status !== "approved") {
      throw makeError("INVALID_APPLICATION_TRANSITION", "Only approved applications can be revoked");
    }

    const status = action === "approve"
      ? "approved"
      : action === "reject"
        ? "rejected"
        : action === "request_info"
          ? "under_review"
          : "approved";
    const needsResubmission = action === "request_info";
    await connection.query(
      `UPDATE verification_applications
       SET status = ?, requested_details = ?, resubmit_requested = ?
       WHERE id = ?`,
      [
        status,
        needsResubmission ? note : null,
        needsResubmission ? 1 : 0,
        applicationId,
      ],
    );
    if (action === "approve" || action === "revoke") {
      await connection.query(
        "UPDATE users SET is_verified = ? WHERE id = ?",
        [action === "approve" ? 1 : 0, application.user_id],
      );
    }
    await connection.query(
      `INSERT INTO verification_review_history
         (application_id, admin_id, action, note)
       VALUES (?, ?, ?, ?)`,
      [applicationId, adminId, action, note],
    );
    await connection.commit();
    transactionStarted = false;
    return {
      applicationId,
      userId: application.user_id,
      action,
      status,
      isVerified: action === "approve" || action === "revoke"
        ? action === "approve"
        : undefined,
      resubmissionRequested: needsResubmission,
    };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  APPLICATION_STATUSES,
  getEligibility,
  getLatestApplication,
  createApplication,
  getApplicationStatus,
  resubmitApplication,
  getStats,
  listApplications,
  reviewApplication,
  makeError,
};
