const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const contentController = require("../controllers/contentController");
const postController = require("../controllers/postController");
const upload = require("../middleware/uploadMiddleware");

router.get("/", authMiddleware, contentController.getReels);
router.get("/user/:userId", authMiddleware, contentController.getUserReels);
router.get("/:reelId/comments", authMiddleware, postController.getComments);
router.post(
  "/",
  authMiddleware,
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "media", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  contentController.createReel,
);
router.post("/:reelId/comments", authMiddleware, postController.createComment);

module.exports = router;

module.exports = router;
