const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "momento",
    resource_type: "auto",
  },
});

const uploadOptions = {
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 },
};
const upload = multer(uploadOptions);
upload.chatAttachment = multer({
  ...uploadOptions,
  fileFilter: (_req, file, callback) => {
    callback(
      null,
      file.mimetype?.startsWith("image/") ||
        file.mimetype?.startsWith("video/"),
    );
  },
}).single("media");

module.exports = upload;
