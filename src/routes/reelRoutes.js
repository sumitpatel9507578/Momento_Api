const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const contentController = require("../controllers/contentController");
const upload = require("../middleware/uploadMiddleware");

router.post("/", authMiddleware, upload.single("video"), contentController.createReel);

module.exports = router;
