const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const closeFriendController = require("../controllers/closeFriendController");

router.use(authMiddleware);
router.get("/", closeFriendController.list);
router.post("/:userId", closeFriendController.add);
router.delete("/:userId", closeFriendController.remove);

module.exports = router;
