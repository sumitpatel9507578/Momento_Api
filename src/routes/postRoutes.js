const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const postController = require("../controllers/postController");
const upload = require("../middleware/uploadMiddleware");

router.get("/", authMiddleware, postController.getFeed);
router.get("/user/:userId", authMiddleware, postController.getUserPosts);
router.get("/:postId/comments", authMiddleware, postController.getComments);
router.post("/", authMiddleware, upload.single("media"), postController.createPost);
router.post("/:postId/comments", authMiddleware, postController.createComment);

module.exports = router;
