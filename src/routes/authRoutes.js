const router = require("express").Router();

const c = require("../controllers/authController");
const upload = require("../middleware/uploadMiddleware");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/register", upload.single("profileImage"), c.register);
router.post("/login", c.login);
router.post("/refresh", c.refresh);
router.post("/logout", authMiddleware, c.logout);
router.post("/forgot-password", c.forgotPassword);
router.post("/reset-password", c.resetPassword);

module.exports = router;
