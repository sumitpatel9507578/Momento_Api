const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const messageController = require("../controllers/messageController");

router.get("/conversations", authMiddleware, messageController.getConversations);
router.get("/:userId", authMiddleware, messageController.getMessages);
router.post("/", authMiddleware, messageController.createMessage);

module.exports = router;
