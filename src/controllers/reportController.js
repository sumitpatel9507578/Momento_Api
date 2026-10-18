const reportModel = require("../models/reportModel");

const MAX_EXPLANATION_LENGTH = 2000;
const MAX_ADMIN_NOTE_LENGTH = 2000;
const MAX_REASON_LENGTH = 100;

function isValidId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0;
  }
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) {
    return false;
  }
  return BigInt(value) <= 9223372036854775807n;
}

function parsePositiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  ) {
    return null;
  }
  return Number(value);
}

function normalizeReport(report) {
  return {
    id: report.id,
    reporter_id: report.reporter_id,
    reporter: report.reporter_username
      ? {
          id: report.reporter_id,
          username: report.reporter_username,
          name: report.reporter_name || "",
          profileImage: report.reporter_profile_image || "",
        }
      : null,
    reported_user_id: report.reported_user_id,
    reportedUser: report.reported_username
      ? {
          id: report.reported_user_id,
          username: report.reported_username,
          name: report.reported_name || "",
          profileImage: report.reported_profile_image || "",
        }
      : null,
    target_type: report.target_type,
    target_id: report.target_id,
    reason: report.reason,
    message: report.message,
    status: report.status,
    admin_note: report.admin_note,
    reviewed_by: report.reviewed_by,
    reviewer: report.reviewer_username
      ? { id: report.reviewed_by, username: report.reviewer_username }
      : null,
    reviewed_at: report.reviewed_at,
    created_at: report.created_at,
    updated_at: report.updated_at,
  };
}

async function createReport(req, res) {
  const reporterId = req.user?.id;
  const targetType =
    typeof req.body?.target_type === "string"
      ? req.body.target_type.trim().toLowerCase()
      : "";
  const targetId = req.body?.target_id;
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const explanation = req.body?.message ?? req.body?.explanation;
  const message =
    explanation === undefined || explanation === null
      ? null
      : typeof explanation === "string"
        ? explanation.trim() || null
        : undefined;

  if (!isValidId(reporterId)) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid authenticated user" });
  }
  if (
    !reportModel.TARGET_TYPES.has(targetType) ||
    !isValidId(targetId) ||
    !reason ||
    reason.length > MAX_REASON_LENGTH ||
    message === undefined ||
    (message !== null && message.length > MAX_EXPLANATION_LENGTH)
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Valid target_type, target_id, reason (up to 100 characters), and message (up to 2000 characters) are required",
    });
  }

  try {
    const id = await reportModel.createReport({
      reporterId,
      targetType,
      targetId,
      reason,
      message,
    });
    return res.status(201).json({
      success: true,
      message: "Report submitted successfully",
      data: { id },
    });
  } catch (error) {
    if (error.code === "REPORT_TARGET_NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === "SELF_REPORT") {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === "DUPLICATE_REPORT") {
      return res.status(409).json({ success: false, message: error.message });
    }
    if (error.code === "REPORT_RATE_LIMITED") {
      return res.status(429).json({ success: false, message: error.message });
    }
    console.error("Create report error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to submit report" });
  }
}

async function listReports(req, res) {
  const page = parsePositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  const limit = parsePositiveInteger(req.query.limit, 20, 100);
  const status =
    req.query.status === undefined ? null : String(req.query.status);
  const targetType =
    req.query.target_type === undefined
      ? null
      : String(req.query.target_type).toLowerCase();
  const reason =
    req.query.reason === undefined ? null : String(req.query.reason).trim();
  const search =
    req.query.search === undefined ? null : String(req.query.search).trim();

  if (
    !page ||
    !limit ||
    page > Math.floor(Number.MAX_SAFE_INTEGER / limit) ||
    (status && !reportModel.REPORT_STATUSES.has(status)) ||
    (targetType && !reportModel.TARGET_TYPES.has(targetType)) ||
    (reason !== null && (!reason || reason.length > MAX_REASON_LENGTH)) ||
    (search !== null && (!search || search.length > 100))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid report filters or pagination values",
    });
  }

  try {
    const result = await reportModel.listReports({
      status,
      targetType,
      reason,
      search,
      limit,
      offset: (page - 1) * limit,
    });
    return res.json({
      success: true,
      data: {
        reports: result.reports.map(normalizeReport),
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      },
    });
  } catch (error) {
    console.error("List reports error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch reports" });
  }
}

async function getReport(req, res) {
  const reportId = req.params.id;
  if (!isValidId(reportId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid report ID is required" });
  }
  try {
    const report = await reportModel.getReportById(reportId);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    const [target, reviewHistory] = await Promise.all([
      reportModel.getReportedTarget(report.target_type, report.target_id),
      reportModel.getReviewHistory(reportId),
    ]);
    return res.json({
      success: true,
      data: {
        report: normalizeReport(report),
        target: target ? { available: true, data: target } : { available: false },
        reviewHistory,
      },
    });
  } catch (error) {
    console.error("Get report error:", error);
    if (error.code === "ER_NO_SUCH_TABLE") {
      return res.status(503).json({
        success: false,
        message: "Apply the report review history migration before viewing report details",
      });
    }
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch report" });
  }
}

async function updateReportStatus(req, res) {
  const reportId = req.params.id;
  const status = req.body?.status;
  const adminNote = req.body?.admin_note;
  if (
    !isValidId(reportId) ||
    typeof status !== "string" ||
    !reportModel.REPORT_STATUSES.has(status) ||
    (adminNote !== undefined &&
      (typeof adminNote !== "string" ||
        adminNote.length > MAX_ADMIN_NOTE_LENGTH))
  ) {
    return res.status(400).json({
      success: false,
      message:
        "A valid report ID and status are required; admin_note must be at most 2000 characters",
    });
  }
  try {
    const updated = await reportModel.updateReportStatus({
      reportId,
      status,
      adminId: req.admin.id,
      adminNote:
        adminNote === undefined ? undefined : adminNote.trim() || null,
    });
    if (!updated) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    return res.json({
      success: true,
      message: "Report status updated successfully",
      data: updated,
    });
  } catch (error) {
    if (error.code === "INVALID_REPORT_TRANSITION") {
      return res.status(409).json({ success: false, message: error.message });
    }
    if (error.code === "INVALID_CURRENT_REPORT_STATUS") {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error("Update report status error:", error);
    if (error.code === "ER_NO_SUCH_TABLE") {
      return res.status(503).json({
        success: false,
        message: "Apply the report review history migration before reviewing reports",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to update report status",
    });
  }
}

module.exports = {
  createReport,
  listReports,
  getReport,
  updateReportStatus,
};
