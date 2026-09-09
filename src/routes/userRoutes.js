const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");

router.get("/me", authMiddleware, userController.getMe);

module.exports = router;
