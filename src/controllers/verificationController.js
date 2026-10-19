const verificationModel = require("../models/verificationModel");

const MAX_APPLICATION_DATA_LENGTH = 20000;

function isValidId(value) {
  return (
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0) ||
    (typeof value === "string" &&
      /^[1-9]\d{0,19}$/.test(value) &&
      BigInt(value) <= 9223372036854775807n)
  );
}

function parseApplicationData(body) {
  const fields = { ...body };
  delete fields.application_data;
  if (body.application_data !== undefined) {
    if (typeof body.application_data !== "string") return null;
    try {
      const parsed = JSON.parse(body.application_data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      Object.assign(fields, parsed);
    } catch {
      return null;
    }
  }
  const serialized = JSON.stringify(fields);
  if (serialized.length > MAX_APPLICATION_DATA_LENGTH) return null;
  return fields;
}

function handleModelError(res, error, fallbackMessage) {
  if (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_FIELD_ERROR") {
    console.error("Verification migration is not applied:", error);
    return res.status(503).json({
      success: false,
      message: "Apply the verification database migration before using verification APIs",
    });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

async function getEligibility(req, res) {
  try {
    const eligibility = await verificationModel.getEligibility(req.user.id);
    if (!eligibility) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const application = await verificationModel.getLatestApplication(req.user.id);
    return res.json({
      success: true,
      data: { ...eligibility, applicationStatus: application?.status || null },
    });
  } catch (error) {
    return handleModelError(res, error, "Failed to check verification eligibility");
  }
}

async function apply(req, res) {
  if (
    !req.verificationDocument ||
    !["identity_document", "document"].includes(req.verificationDocumentField)
  ) {
    return res.status(400).json({
      success: false,
      message: "A Government ID or passport document is required",
    });
  }
  const applicationData = parseApplicationData(req.body || {});
  if (!applicationData) {
    return res.status(400).json({
      success: false,
      message: "application_data must be valid JSON object data within 20000 characters",
    });
  }
  try {
    const eligibility = await verificationModel.getEligibility(req.user.id);
    if (!eligibility) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (!eligibility.eligible) {
      return res.status(403).json({
        success: false,
        message: "Verification eligibility requirements are not met",
        data: eligibility.requirements,
      });
    }
    const id = await verificationModel.createApplication({
      userId: req.user.id,
      applicationData,
      document: req.verificationDocument,
    });
    return res.status(201).json({
      success: true,
      message: "Verification application submitted successfully",
      data: { id, status: "submitted" },
    });
  } catch (error) {
    if (error.code === "ALREADY_VERIFIED") {
      return res.status(409).json({ success: false, message: error.message });
    }
    if (error.code === "APPLICATION_IN_PROGRESS") {
      return res.status(409).json({ success: false, message: error.message });
    }
    if (error.code === "USER_NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    return handleModelError(res, error, "Failed to submit verification application");
  }
}

async function getStatus(req, res) {
  try {
    const [application, eligibility] = await Promise.all([
      verificationModel.getApplicationStatus(req.user.id),
      verificationModel.getEligibility(req.user.id),
    ]);
    if (!eligibility) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.json({
      success: true,
      data: {
        status: application?.status || null,
        requestedDetails: application?.requested_details || null,
        resubmissionRequested: Boolean(application?.resubmit_requested),
        isVerified: eligibility.isVerified,
        createdAt: application?.created_at || null,
        updatedAt: application?.updated_at || null,
      },
    });
  } catch (error) {
    return handleModelError(res, error, "Failed to fetch verification status");
  }
}

async function resubmit(req, res) {
  const applicationData = parseApplicationData(req.body || {});
  if (!applicationData) {
    return res.status(400).json({
      success: false,
      message: "Submitted details must be valid and within 20000 characters",
    });
  }
  try {
    const id = await verificationModel.resubmitApplication({
      userId: req.user.id,
      applicationData,
      document: req.verificationDocument,
    });
    return res.json({
      success: true,
      message: "Verification information resubmitted successfully",
      data: { id, status: "submitted" },
    });
  } catch (error) {
    if (error.code === "RESUBMISSION_NOT_REQUESTED") {
      return res.status(409).json({ success: false, message: error.message });
    }
    return handleModelError(res, error, "Failed to resubmit verification information");
  }
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

async function getStats(_req, res) {
  try {
    return res.json({ success: true, data: await verificationModel.getStats() });
  } catch (error) {
    return handleModelError(res, error, "Failed to fetch verification statistics");
  }
}

async function listApplications(req, res) {
  const page = parsePositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  const limit = parsePositiveInteger(req.query.limit, 20, 100);
  const status = req.query.status === undefined ? null : String(req.query.status);
  const search = req.query.search === undefined ? null : String(req.query.search).trim();
  if (
    !page ||
    !limit ||
    page > Math.floor(Number.MAX_SAFE_INTEGER / limit) ||
    (status && !verificationModel.APPLICATION_STATUSES.has(status)) ||
    (search !== null && (!search || search.length > 100))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid verification filters or pagination values",
    });
  }
  try {
    const result = await verificationModel.listApplications({
      status,
      search,
      limit,
      offset: (page - 1) * limit,
    });
    return res.json({
      success: true,
      data: {
        applications: result.applications,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      },
    });
  } catch (error) {
    return handleModelError(res, error, "Failed to fetch verification applications");
  }
}

async function review(req, res) {
  const applicationId = req.body?.application_id;
  const action = req.body?.action;
  const note = req.body?.note;
  if (
    !isValidId(applicationId) ||
    !["approve", "reject", "revoke", "request_info"].includes(action) ||
    (note !== undefined &&
      (typeof note !== "string" || note.trim().length > 2000)) ||
    (action === "request_info" && !String(note || "").trim())
  ) {
    return res.status(400).json({
      success: false,
      message: "A valid application_id and action are required; request_info requires a note",
    });
  }
  try {
    const result = await verificationModel.reviewApplication({
      applicationId,
      action,
      adminId: req.admin.id,
      note: typeof note === "string" ? note.trim() || null : null,
    });
    if (!result) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }
    return res.json({
      success: true,
      message: "Verification application review completed",
      data: result,
    });
  } catch (error) {
    if (error.code === "INVALID_APPLICATION_TRANSITION") {
      return res.status(409).json({ success: false, message: error.message });
    }
    return handleModelError(res, error, "Failed to review verification application");
  }
}

module.exports = {
  getEligibility,
  apply,
  getStatus,
  resubmit,
  getStats,
  listApplications,
  review,
};
