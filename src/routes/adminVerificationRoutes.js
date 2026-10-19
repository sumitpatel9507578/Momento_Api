const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const controller = require("../controllers/verificationController");

router.use(authMiddleware, adminMiddleware);
router.get("/stats", controller.getStats);
router.get("/applications", controller.listApplications);
router.post("/review", controller.review);

module.exports = router;
