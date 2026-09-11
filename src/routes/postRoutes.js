const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const postController = require("../controllers/postController");
const upload = require("../middleware/uploadMiddleware");

router.post("/", authMiddleware, upload.single("media"), postController.createPost);
router.post("/:postId/comments", authMiddleware, postController.createComment);

module.exports = router;
