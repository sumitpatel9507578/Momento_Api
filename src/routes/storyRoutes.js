const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const contentController = require("../controllers/contentController");

router.post("/", authMiddleware, contentController.createStory);

module.exports = router;
