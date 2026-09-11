const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");
const upload = require("../middleware/uploadMiddleware");

router.get("/me", authMiddleware, userController.getMe);
router.put("/:id", authMiddleware, upload.single("profileImage"), userController.updateProfile);

module.exports = router;
