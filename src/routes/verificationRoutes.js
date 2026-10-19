const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const verificationUpload = require("../middleware/verificationUploadMiddleware");
const controller = require("../controllers/verificationController");

router.use(authMiddleware);
router.get("/eligibility", controller.getEligibility);
router.post("/apply", verificationUpload, controller.apply);
router.get("/status", controller.getStatus);
router.post("/resubmit", verificationUpload, controller.resubmit);

module.exports = router;
