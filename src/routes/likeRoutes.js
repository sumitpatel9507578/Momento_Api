const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const postController = require("../controllers/postController");

router.post("/post/:postId", authMiddleware, postController.likePost);
router.post("/reel/:reelId", authMiddleware, postController.likePost);
router.post("/", authMiddleware, postController.likePost);

module.exports = router;
