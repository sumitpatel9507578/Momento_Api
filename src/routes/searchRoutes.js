const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");

router.get("/users", authMiddleware, userController.searchUsers);

module.exports = router;
