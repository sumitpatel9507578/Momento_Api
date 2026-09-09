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

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/follows", followRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/reels", reelRoutes);
app.use("/api/stories", storyRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);

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

module.exports = app;
