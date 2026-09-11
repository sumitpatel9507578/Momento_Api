const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const contentController = require("../controllers/contentController");
const upload = require("../middleware/uploadMiddleware");

router.get("/", authMiddleware, contentController.getReels);
router.get("/user/:userId", authMiddleware, contentController.getUserReels);
router.post("/", authMiddleware, upload.single("video"), contentController.createReel);

module.exports = router;
