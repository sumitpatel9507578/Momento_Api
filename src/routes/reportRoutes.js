const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const reportController = require("../controllers/reportController");

const userRoutes = express.Router();
userRoutes.post("/", authMiddleware, reportController.createReport);

const adminRoutes = express.Router();
adminRoutes.use(authMiddleware, adminMiddleware);
adminRoutes.get("/", reportController.listReports);
adminRoutes.get("/:id", reportController.getReport);
adminRoutes.patch("/:id/status", reportController.updateReportStatus);
adminRoutes.post("/action", reportController.reviewReportAction);

module.exports = { userRoutes, adminRoutes };
