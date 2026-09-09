const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const postController = require("../controllers/postController");

router.post("/:postId", authMiddleware, postController.likePost);

module.exports = router;
