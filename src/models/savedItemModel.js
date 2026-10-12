const db = require("../config/db");

function createNotFoundError(itemType) {
  const error = new Error(
    itemType === "message" ? "Message not found" : "Reel not found",
  );
  error.code = "SAVED_ITEM_NOT_FOUND";
  return error;
}

function createForbiddenError() {
  const error = new Error("You are not a participant in this conversation");
  error.code = "SAVED_ITEM_FORBIDDEN";
  return error;
}

function isDuplicateKeyError(error) {
  return error.code === "ER_DUP_ENTRY";
}

// Save a message bookmark only for a participant in its conversation.
async function saveMessage(userId, messageId) {
  const [messages] = await db.query(
    `SELECT id, sender_id, receiver_id FROM messages WHERE id = ?`,
    [messageId],
  );
  const message = messages[0];
  if (!message) throw createNotFoundError("message");
  if (message.sender_id !== userId && message.receiver_id !== userId) {
    throw createForbiddenError();
  }

  const [existing] = await db.query(
    `SELECT message_id FROM saved_messages WHERE user_id = ? AND message_id = ?`,
    [userId, messageId],
  );
  if (existing.length > 0) return { saved: true, alreadySaved: true };

  try {
    await db.query(
      `INSERT INTO saved_messages (user_id, message_id) VALUES (?, ?)`,
      [userId, messageId],
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return { saved: true, alreadySaved: true };
  }
  return { saved: true, alreadySaved: false };
}

// Remove only the authenticated user's bookmark; missing bookmarks are idempotent.
async function unsaveMessage(userId, messageId) {
  await db.query(
    `DELETE FROM saved_messages WHERE user_id = ? AND message_id = ?`,
    [userId, messageId],
  );
  return { saved: false };
}

// Save a reel reference, not a downloaded or duplicated copy of its video.
async function saveReel(userId, reelId) {
  const [reels] = await db.query(`SELECT id FROM reels WHERE id = ?`, [reelId]);
  if (reels.length === 0) throw createNotFoundError("reel");

  const [existing] = await db.query(
    `SELECT reel_id FROM saved_reels WHERE user_id = ? AND reel_id = ?`,
    [userId, reelId],
  );
  if (existing.length > 0) return { saved: true, alreadySaved: true };

  try {
    await db.query(
      `INSERT INTO saved_reels (user_id, reel_id) VALUES (?, ?)`,
      [userId, reelId],
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return { saved: true, alreadySaved: true };
  }
  return { saved: true, alreadySaved: false };
}

// Remove only the authenticated user's reel bookmark; the reel itself is unchanged.
async function unsaveReel(userId, reelId) {
  await db.query(
    `DELETE FROM saved_reels WHERE user_id = ? AND reel_id = ?`,
    [userId, reelId],
  );
  return { saved: false };
}

// Load the user's saved message and reel references from MySQL.
async function getSavedItems(userId) {
  const [messageRows] = await db.query(
    `SELECT m.id AS itemId, sm.saved_at AS savedAt,
            m.sender_id AS senderId, m.receiver_id AS receiverId,
            m.message, m.message_type AS messageType,
            m.media_url AS mediaUrl, m.created_at AS createdAt,
            m.reel_id AS reelId, r.video_url AS reelVideoUrl,
            r.caption AS reelCaption, r.user_id AS reelOwnerId,
            reel_owner.username AS reelOwnerUsername,
            CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
              AS conversationUserId,
            peer.username AS conversationUsername,
            peer.full_name AS conversationName,
            peer.profileImage AS conversationProfileImage
     FROM saved_messages sm
     JOIN messages m ON m.id = sm.message_id
     JOIN users peer
       ON peer.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
     LEFT JOIN reels r ON r.id = m.reel_id
     LEFT JOIN users reel_owner ON reel_owner.id = r.user_id
     WHERE sm.user_id = ?`,
    [userId, userId, userId],
  );
  const [reelRows] = await db.query(
    `SELECT r.id AS itemId, sr.saved_at AS savedAt,
            r.user_id AS reelOwnerId, r.video_url AS videoUrl,
            r.caption, r.song_name AS songName,
            owner.username AS reelOwnerUsername,
            owner.full_name AS reelOwnerName,
            owner.profileImage AS reelOwnerProfileImage
     FROM saved_reels sr
     JOIN reels r ON r.id = sr.reel_id
     JOIN users owner ON owner.id = r.user_id
     WHERE sr.user_id = ?`,
    [userId],
  );

  const items = [
    ...messageRows.map((row) => ({ itemType: "message", ...row })),
    ...reelRows.map((row) => ({ itemType: "reel", ...row })),
  ];
  items.sort((left, right) => new Date(right.savedAt) - new Date(left.savedAt));
  return items;
}

module.exports = {
  saveMessage,
  unsaveMessage,
  saveReel,
  unsaveReel,
  getSavedItems,
};
