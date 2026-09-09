const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const messageController = require("../controllers/messageController");

router.post("/", authMiddleware, messageController.createMessage);

module.exports = router;
