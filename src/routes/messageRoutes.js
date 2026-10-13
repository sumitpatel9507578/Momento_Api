const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const messageController = require("../controllers/messageController");
const upload = require("../middleware/uploadMiddleware");

router.get("/conversations", authMiddleware, messageController.getConversations);
router.post(
  "/upload",
  authMiddleware,
  upload.chatAttachment,
  messageController.uploadMessageAttachment,
);
router.get("/:userId", authMiddleware, messageController.getMessages);
router.post("/", authMiddleware, messageController.createMessage);

module.exports = router;
