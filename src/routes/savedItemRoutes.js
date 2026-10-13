const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const savedItemController = require("../controllers/savedItemController");

router.use(authMiddleware);
router.get("/", savedItemController.getSavedItems);
router.post("/messages/:itemId", savedItemController.saveMessage);
router.delete("/messages/:itemId", savedItemController.unsaveMessage);
router.post("/reels/:itemId", savedItemController.saveReel);
router.delete("/reels/:itemId", savedItemController.unsaveReel);
router.post("/posts/:itemId", savedItemController.savePost);
router.delete("/posts/:itemId", savedItemController.unsavePost);

module.exports = router;
