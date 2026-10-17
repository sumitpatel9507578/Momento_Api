const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const commentController = require("../controllers/commentController");

router.use(authMiddleware);
router.post("/:commentId/like", commentController.toggleLike);
router.post("/:commentId/pin", commentController.pinComment);
router.get("/:commentId/replies", commentController.getReplies);
router.put("/:commentId", commentController.updateComment);
router.delete("/:commentId", commentController.deleteComment);

module.exports = router;
