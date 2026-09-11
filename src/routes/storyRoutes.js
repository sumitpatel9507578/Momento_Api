const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const contentController = require("../controllers/contentController");
const upload = require("../middleware/uploadMiddleware");

router.get("/", authMiddleware, contentController.getStories);
router.post("/", authMiddleware, upload.single("media"), contentController.createStory);

module.exports = router;
