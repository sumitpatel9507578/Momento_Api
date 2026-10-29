const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const adminController = require("../controllers/adminController");

router.use(authMiddleware, adminMiddleware);

router.get("/admin/stats", adminController.getDashboardStats);

router.put("/admin/users/:id/block", adminController.toggleBlockUser);
router.post("/admin/users/:id/block", adminController.toggleBlockUser);
router.put("/admin/users/:id/unblock", (req, res) => {
  req.body = { ...(req.body || {}), isBlocked: false };
  return adminController.toggleBlockUser(req, res);
});
router.post("/admin/users/:id/unblock", (req, res) => {
  req.body = { ...(req.body || {}), isBlocked: false };
  return adminController.toggleBlockUser(req, res);
});
router.put("/admin/users/:id/verify", adminController.toggleVerification);
router.delete("/admin/users/:id", adminController.deleteUser);

router.delete("/admin/posts/:id", adminController.deletePost);
router.delete("/admin/reels/:id", adminController.deleteReel);

module.exports = router;
