const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const followController = require("../controllers/followController");

router.post("/:userId", authMiddleware, followController.followUser);

module.exports = router;
