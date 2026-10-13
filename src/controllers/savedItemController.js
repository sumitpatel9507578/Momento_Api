const savedItemModel = require("../models/savedItemModel");

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function handleSavedItemError(res, error, action) {
  console.error(`${action} error:`, error);
  if (error.code === "SAVED_ITEM_NOT_FOUND") {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.code === "SAVED_ITEM_FORBIDDEN") {
    return res.status(403).json({ success: false, message: error.message });
  }
  if (error.code === "ER_NO_SUCH_TABLE") {
    return res.status(503).json({
      success: false,
      message: "Saved items require the approved saved-items database migration",
    });
  }
  return res.status(500).json({
    success: false,
    message: "Failed to update saved items",
  });
}

// Save or remove a bookmark owned by the authenticated user.
async function updateSavedItem(req, res, itemType, shouldSave) {
  const userId = parsePositiveId(req.user?.id);
  const itemId = parsePositiveId(req.params.itemId);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Invalid authenticated user" });
  }
  if (!itemId) {
    return res.status(400).json({ success: false, message: "Item ID must be a positive integer" });
  }

  try {
    const operation =
      itemType === "message"
        ? shouldSave
          ? savedItemModel.saveMessage
          : savedItemModel.unsaveMessage
        : itemType === "post"
          ? shouldSave
            ? savedItemModel.savePost
            : savedItemModel.unsavePost
          : shouldSave
            ? savedItemModel.saveReel
            : savedItemModel.unsaveReel;
    const data = await operation(userId, itemId);
    return res.status(200).json({
      success: true,
      message: data.alreadySaved
        ? "Item was already saved"
        : shouldSave
          ? "Item saved"
          : "Item unsaved",
      data: { itemType, itemId, ...data },
    });
  } catch (error) {
    return handleSavedItemError(res, error, `${shouldSave ? "Save" : "Unsave"} ${itemType}`);
  }
}

async function saveMessage(req, res) {
  return updateSavedItem(req, res, "message", true);
}

async function unsaveMessage(req, res) {
  return updateSavedItem(req, res, "message", false);
}

async function saveReel(req, res) {
  return updateSavedItem(req, res, "reel", true);
}

async function unsaveReel(req, res) {
  return updateSavedItem(req, res, "reel", false);
}

async function savePost(req, res) {
  return updateSavedItem(req, res, "post", true);
}

async function unsavePost(req, res) {
  return updateSavedItem(req, res, "post", false);
}

async function getSavedItems(req, res) {
  const userId = parsePositiveId(req.user?.id);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Invalid authenticated user" });
  }

  try {
    const items = await savedItemModel.getSavedItems(userId);
    return res.status(200).json({
      success: true,
      message: "Saved items fetched successfully",
      data: items,
    });
  } catch (error) {
    return handleSavedItemError(res, error, "Fetch saved items");
  }
}

module.exports = {
  saveMessage,
  unsaveMessage,
  saveReel,
  unsaveReel,
  savePost,
  unsavePost,
  getSavedItems,
};
