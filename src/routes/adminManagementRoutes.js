const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const users = require("../controllers/adminUserController");
const content = require("../controllers/adminContentController");
const dashboard = require("../controllers/adminDashboardController");
const settings = require("../controllers/adminSettingsController");

router.use(authMiddleware, adminMiddleware);

router.get("/users", users.listUsers);
router.get("/users/:id", users.getUser);
router.post("/users/:id/block", (req, res) => users.setBlocked(req, res, true));
router.put("/users/:id/block", (req, res) => users.setBlocked(req, res, true));
router.post("/users/:id/unblock", (req, res) => users.setBlocked(req, res, false));
router.put("/users/:id/unblock", (req, res) => users.setBlocked(req, res, false));
router.post("/users/:id/verify", (req, res) => users.setVerified(req, res, true));
router.post("/users/:id/unverify", (req, res) => users.setVerified(req, res, false));
router.put("/users/:id/verify", (req, res) => users.setVerified(req, res, true));
router.delete("/users/:id/verify", (req, res) => users.setVerified(req, res, false));
router.put("/users/:id/role", users.setRole);
router.post("/users/:id/promote", (req, res) => { req.body = { ...req.body, role: "admin" }; return users.setRole(req, res); });
router.post("/users/:id/demote", (req, res) => { req.body = { ...req.body, role: "user" }; return users.setRole(req, res); });
router.delete("/users/:id", users.deleteUser);

router.get("/posts", content.getPosts);
router.get("/posts/:id", content.getPost);
router.delete("/posts/:id", content.deletePost);
router.get("/reels", content.getReels);
router.get("/reels/:id", content.getReel);
router.delete("/reels/:id", content.deleteReel);

router.get("/dashboard/overview", dashboard.overview);
router.get("/dashboard/growth", dashboard.growth);
router.get("/dashboard/engagement", dashboard.engagement);
router.get("/dashboard/trending", dashboard.trending);
router.get("/dashboard/export/csv", (req, res) => dashboard.exportData(req, res, "csv"));
router.get("/dashboard/export/pdf", (req, res) => dashboard.exportData(req, res, "pdf"));
router.get("/analytics/export/csv", (req, res) => dashboard.exportData(req, res, "csv"));
router.get("/analytics/export/pdf", (req, res) => dashboard.exportData(req, res, "pdf"));

router.get("/settings", settings.getSettings);
router.put("/settings", settings.updateSettings);
router.patch("/settings", settings.updateSettings);
router.get("/health", settings.health);

module.exports = router;
