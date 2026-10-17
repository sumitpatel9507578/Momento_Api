const repostModel = require("../models/repostModel");
const userModel = require("../models/userModel");

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function handleRepostError(res, error) {
  console.error("Repost error:", error);
  if (error.code === "INVALID_REPOST_TARGET") {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error.code === "REPOST_TARGET_NOT_FOUND") {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.code === "ER_NO_SUCH_TABLE") {
    return res.status(503).json({
      success: false,
      message: "The reposts table is not available on this database",
    });
  }
  return res
    .status(500)
    .json({ success: false, message: "Repost request failed" });
}

async function createRepost(req, res) {
  const userId = parsePositiveId(req.user?.id);
  const rawPostId = req.body.postId ?? req.body.post_id;
  const rawReelId = req.body.reelId ?? req.body.reel_id;
  const hasPostId =
    rawPostId !== undefined && rawPostId !== null && rawPostId !== "";
  const hasReelId =
    rawReelId !== undefined && rawReelId !== null && rawReelId !== "";
  const postId = hasPostId ? parsePositiveId(rawPostId) : null;
  const reelId = hasReelId ? parsePositiveId(rawReelId) : null;
  const note = req.body.note ?? null;

  if (!userId) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid authenticated user" });
  }
  if (
    hasPostId === hasReelId ||
    (hasPostId && !postId) ||
    (hasReelId && !reelId)
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide exactly one valid postId or reelId",
    });
  }
  if (note !== null && typeof note !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "note must be a string or null" });
  }

  try {
    const repost = await repostModel.createRepost(
      userId,
      postId,
      reelId,
      typeof note === "string" ? note.trim() || null : null,
    );
    return res.status(repost.alreadyReposted ? 200 : 201).json({
      success: true,
      message: repost.alreadyReposted ? "Already reposted" : "Repost created",
      data: repost,
    });
  } catch (error) {
    return handleRepostError(res, error);
  }
}

async function getMyReposts(req, res) {
  const userId = parsePositiveId(req.user?.id);
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid authenticated user" });
  }
  try {
    const reposts = await repostModel.getRepostsByUser(userId);
    return res.status(200).json({ success: true, data: reposts });
  } catch (error) {
    return handleRepostError(res, error);
  }
}

async function getUserReposts(req, res) {
  const userId = parsePositiveId(req.params.userId);
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "userId must be a positive integer" });
  }
  try {
    if (!(await userModel.getUserById(userId))) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    const reposts = await repostModel.getRepostsByUser(userId);
    return res.status(200).json({ success: true, data: reposts });
  } catch (error) {
    return handleRepostError(res, error);
  }
}

async function deleteRepost(req, res) {
  const userId = parsePositiveId(req.user?.id);
  const repostId = parsePositiveId(req.params.repostId);
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid authenticated user" });
  }
  if (!repostId) {
    return res
      .status(400)
      .json({ success: false, message: "repostId must be a positive integer" });
  }
  try {
    const deleted = await repostModel.deleteRepost(userId, repostId);
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Repost not found" });
    }
    return res
      .status(200)
      .json({ success: true, data: { repostId, reposted: false } });
  } catch (error) {
    return handleRepostError(res, error);
  }
}

module.exports = { createRepost, getMyReposts, getUserReposts, deleteRepost };
