const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const followRoutes = require("./routes/followRoutes");
const postRoutes = require("./routes/postRoutes");
const likeRoutes = require("./routes/likeRoutes");
const reelRoutes = require("./routes/reelRoutes");
const storyRoutes = require("./routes/storyRoutes");
const messageRoutes = require("./routes/messageRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const savedItemRoutes = require("./routes/savedItemRoutes");
const closeFriendRoutes = require("./routes/closeFriendRoutes");
const searchRoutes = require("./routes/searchRoutes");
const exploreController = require("./controllers/exploreController");
const commentRoutes = require("./routes/commentRoutes");
const repostRoutes = require("./routes/repostRoutes");
const reportRoutes = require("./routes/reportRoutes");

const app = express();

app.use(cors());
app.use(
  "/api/reports",
  express.json({ limit: "8kb" }),
  express.urlencoded({ extended: true, limit: "8kb" }),
  reportRoutes.userRoutes,
);
app.use(
  "/api/admin/reports",
  express.json({ limit: "8kb" }),
  express.urlencoded({ extended: true, limit: "8kb" }),
  reportRoutes.adminRoutes,
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/follows", followRoutes);
app.use("/api/close-friends", closeFriendRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/reels", reelRoutes);
app.use("/api/stories", storyRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/reposts", repostRoutes);
app.use("/api/saved-items", savedItemRoutes);
app.use("/api/saved", savedItemRoutes);
app.use("/api/search", searchRoutes);
app.get(
  "/api/explore",
  require("./middleware/authMiddleware"),
  exploreController.getExplore,
);

// Provide a lightweight endpoint for Render health checks
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Momento API is healthy",
    data: null,
  });
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Momento backend is running",
  });
});

app.use((error, req, res, next) => {
  const isReportRequest =
    req.originalUrl.startsWith("/api/reports") ||
    req.originalUrl.startsWith("/api/admin/reports");
  if (!isReportRequest) return next(error);
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Report request payload is too large.",
    });
  }
  if (
    error instanceof SyntaxError &&
    error.status === 400 &&
    Object.prototype.hasOwnProperty.call(error, "body")
  ) {
    return res.status(400).json({
      success: false,
      message: "Report request body must contain valid JSON",
    });
  }
  console.error("Report request parsing error:", error.code || error.message);
  return res.status(400).json({
    success: false,
    message: "Invalid report request",
  });
});

app.use((error, req, res, next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "Uploaded file is too large. Maximum size is 100MB.",
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message:
        req.originalUrl.startsWith("/api/reports") ||
        req.originalUrl.startsWith("/api/admin/reports")
          ? "Report request payload is too large."
          : "Request payload is too large. Send reels as multipart/form-data.",
    });
  }

  next(error);
});

module.exports = app;
