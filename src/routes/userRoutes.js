const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");
const upload = require("../middleware/uploadMiddleware");

router.get("/me", authMiddleware, userController.getMe);
router.get("/search", authMiddleware, userController.searchUsers);
router.put(
  "/:id",
  authMiddleware,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "profile_image", maxCount: 1 },
    { name: "profileimage", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "file", maxCount: 1 },
    { name: "media", maxCount: 1 },
  ]),
  userController.updateProfile,
);

module.exports = router;
