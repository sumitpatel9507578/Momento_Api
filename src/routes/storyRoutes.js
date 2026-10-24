const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const contentController = require("../controllers/contentController");
const upload = require("../middleware/uploadMiddleware");

router.get("/", authMiddleware, contentController.getStories);
router.post("/:storyId/like", authMiddleware, contentController.likeStory);
router.put("/:storyId/view", authMiddleware, contentController.viewStory);
router.delete("/:storyId", authMiddleware, contentController.deleteStory);
router.post(
  "/",
  authMiddleware,
  upload.fields([
    { name: "story", maxCount: 1 },
    { name: "media", maxCount: 1 },
  ]),
  contentController.createStory,
  (error, req, res, next) => {
    console.error("Story upload error:", error);
    const statusCode =
      error.code === "LIMIT_FILE_SIZE"
        ? 413
        : error.name === "MulterError"
          ? 400
          : 502;
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Uploaded file is too large. Maximum size is 100MB."
        : error.name === "MulterError"
          ? error.message
          : "Failed to upload story media";
    return res.status(statusCode).json({
      success: false,
      message,
    });
  },
);

module.exports = router;
