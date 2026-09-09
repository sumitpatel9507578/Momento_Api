const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const postController = require("../controllers/postController");

router.post("/", authMiddleware, postController.createPost);
router.post("/:postId/comments", authMiddleware, postController.createComment);

module.exports = router;
