const multer = require("multer");
const { Readable } = require("node:stream");
const cloudinary = require("../config/cloudinary");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]);
    callback(
      allowedTypes.has(file.mimetype)
        ? null
        : new Error("Government ID must be a PDF, JPEG, or PNG file"),
      allowedTypes.has(file.mimetype),
    );
  },
}).fields([
  { name: "identity_document", maxCount: 1 },
  { name: "document", maxCount: 1 },
  { name: "additional_document", maxCount: 1 },
]);

function uploadPrivateDocument(file) {
  return new Promise((resolve, reject) => {
    const resourceType = file.mimetype.startsWith("image/") ? "image" : "raw";
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "momento/verification",
        resource_type: resourceType,
        type: "authenticated",
        use_filename: false,
        unique_filename: true,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.public_id || !result?.format) {
          return reject(new Error("Cloudinary returned incomplete upload details"));
        }
        return resolve({
          publicId: result.public_id,
          resourceType,
          format: result.format,
        });
      },
    );
    Readable.from(file.buffer).pipe(stream);
  });
}

module.exports = function verificationUploadMiddleware(req, res, next) {
  upload(req, res, async (multerError) => {
    if (multerError) {
      const status = multerError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({
        success: false,
        message: multerError.message,
      });
    }

    const files = req.files || {};
    const selected = [
      ["identity_document", files.identity_document?.[0]],
      ["document", files.document?.[0]],
      ["additional_document", files.additional_document?.[0]],
    ].filter(([, file]) => file);
    if (selected.length > 1) {
      return res.status(400).json({
        success: false,
        message: "Upload only one verification document per request",
      });
    }

    if (!selected[0]) {
      req.verificationDocument = null;
      req.verificationDocumentField = null;
      return next();
    }

    try {
      [req.verificationDocumentField] = selected[0];
      req.verificationDocument = await uploadPrivateDocument(selected[0][1]);
      return next();
    } catch (error) {
      console.error("Verification document upload error:", error);
      return res.status(502).json({
        success: false,
        message: "Verification document could not be uploaded",
      });
    }
  });
};
