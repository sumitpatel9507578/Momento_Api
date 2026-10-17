const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const repostController = require("../controllers/repostController");

router.use(authMiddleware);
router.get("/", repostController.getMyReposts);
router.get("/user/:userId", repostController.getUserReposts);
router.post("/", repostController.createRepost);
router.delete("/:repostId", repostController.deleteRepost);

module.exports = router;
