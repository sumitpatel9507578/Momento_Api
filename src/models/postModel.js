const db = require("../config/db");
const notificationModel = require("./notificationModel");
const { MESSAGE_TYPES } = require("../utils/messageTypes");

// Read table metadata so SQL only uses columns that the database actually has.
async function getTableCols(tableName) {
  const [columns] = await db.query(`SHOW COLUMNS FROM ${tableName}`);
  return columns.map((column) => column.Field);
}

async function createPost(userId, caption, mediaUrl, mediaType) {
  const cols = await getTableCols("posts");
  const uIdCol = cols.includes("userId") ? "userId" : "user_id";
  const urlCol = cols.includes("mediaUrl") ? "mediaUrl" : "media_url";
  const typeCol = cols.includes("mediaType") ? "mediaType" : "media_type";

  const query = `INSERT INTO posts (${uIdCol}, caption, ${urlCol}, ${typeCol}) VALUES (?, ?, ?, ?)`;
  const [result] = await db.query(query, [
    userId,
    caption || null,
    mediaUrl || null,
    mediaType || "image",
  ]);
  return getPostById(result.insertId);
}

async function getPostById(postId, viewerId = null) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name, u.profileImage,
            (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likesCount,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS commentsCount,
            EXISTS (SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) AS isLiked,
            EXISTS (SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = ?) AS isSaved
     FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [viewerId, viewerId, postId],
  );
  return _mapPost(rows[0]);
}

async function getFeed(
  limit = 20,
  offset = 0,
  viewerId = null,
  followingOnly = false,
) {
  const followFilter = followingOnly
    ? "AND (p.user_id = ? OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = p.user_id))"
    : "";
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name AS name, u.profileImage AS profile_image,
     (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likesCount,
     (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as commentsCount,
     EXISTS (
       SELECT 1 FROM likes viewer_like
       WHERE viewer_like.post_id = p.id AND viewer_like.user_id = ?
     ) AS isLiked,
     EXISTS (
       SELECT 1 FROM saved_posts viewer_saved
       WHERE viewer_saved.post_id = p.id AND viewer_saved.user_id = ?
     ) AS isSaved
     FROM posts p
     JOIN users u ON p.user_id = u.id
     WHERE 1 = 1 ${followFilter}
     ORDER BY p.created_at DESC
     LIMIT ?, ?`,
    followingOnly
      ? [viewerId, viewerId, viewerId, viewerId, offset, limit]
      : [viewerId, viewerId, offset, limit],
  );
  return rows.map(_mapPost);
}

async function getPostsByUserId(userId, viewerId = null) {
  const [rows] = await db.query(
    `SELECT p.*, u.username, u.full_name, u.profileImage,
     (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likesCount,
     (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as commentsCount,
     EXISTS (
       SELECT 1 FROM likes viewer_like
       WHERE viewer_like.post_id = p.id AND viewer_like.user_id = ?
     ) AS isLiked,
     EXISTS (
       SELECT 1 FROM saved_posts viewer_saved
       WHERE viewer_saved.post_id = p.id AND viewer_saved.user_id = ?
     ) AS isSaved
     FROM posts p
     JOIN users u ON p.user_id = u.id
     WHERE p.user_id = ?
     ORDER BY p.id DESC`,
    [viewerId, viewerId, userId],
  );
  return rows.map(_mapPost);
}

function _mapPost(p) {
  if (!p) return null;
  return {
    id: p.id,
    userId: p.userId || p.user_id,
    username: p.username || "Anonymous",
    name: p.full_name || p.name || "",
    profileImage: p.profileImage || p.profile_image || "",
    mediaUrl: p.mediaUrl || p.media_url || "",
    mediaType: p.mediaType || p.media_type || "image",
    caption: p.caption || "",
    likesCount: p.likesCount || 0,
    commentsCount: p.commentsCount || 0,
    isLiked: Boolean(p.isLiked),
    isSaved: Boolean(p.isSaved),
    createdAt: p.createdAt || p.created_at || null,
  };
}

// --- Social ---
function getLikeTarget(postId, reelId = null) {
  const hasPostId = postId !== undefined && postId !== null && postId !== "";
  const hasReelId = reelId !== undefined && reelId !== null && reelId !== "";

  if (hasPostId === hasReelId) {
    const error = new Error("Exactly one postId or reelId is required");
    error.code = "INVALID_LIKE_TARGET";
    throw error;
  }

  return hasPostId
    ? { table: "posts", column: "post_id", id: postId }
    : { table: "reels", column: "reel_id", id: reelId };
}

async function ensureLikeTargetExists(target) {
  const [rows] = await db.query(`SELECT id FROM ${target.table} WHERE id = ?`, [
    target.id,
  ]);
  if (rows.length === 0) {
    const error = new Error(
      `${target.table === "posts" ? "Post" : "Reel"} not found`,
    );
    error.code = "LIKE_TARGET_NOT_FOUND";
    throw error;
  }
}

async function getContentOwner(postId, reelId = null) {
  const target = getLikeTarget(postId, reelId);
  const [rows] = await db.query(
    `SELECT user_id FROM ${target.table} WHERE id = ?`,
    [target.id],
  );
  return rows[0]?.user_id ?? null;
}

async function getLike(userId, postId, reelId = null) {
  const target = getLikeTarget(postId, reelId);
  const cols = await getTableCols("likes");
  if (!cols.includes(target.column)) {
    const error = new Error(
      "The likes table does not support reel likes; add the reel_id column and make post_id nullable.",
    );
    error.code = "REEL_LIKES_MIGRATION_REQUIRED";
    throw error;
  }

  await ensureLikeTargetExists(target);
  const [rows] = await db.query(
    `SELECT id FROM likes WHERE user_id = ? AND ${target.column} = ?`,
    [userId, target.id],
  );
  return rows[0];
}

async function createLike(userId, postId, reelId = null) {
  const target = getLikeTarget(postId, reelId);
  const cols = await getTableCols("likes");
  if (!cols.includes(target.column)) {
    const error = new Error(
      "The likes table does not support reel likes; add the reel_id column and make post_id nullable.",
    );
    error.code = "REEL_LIKES_MIGRATION_REQUIRED";
    throw error;
  }

  await ensureLikeTargetExists(target);
  await db.query(
    `INSERT INTO likes (user_id, ${target.column}) VALUES (?, ?)`,
    [userId, target.id],
  );
}

async function deleteLike(userId, postId, reelId = null) {
  const target = getLikeTarget(postId, reelId);
  const cols = await getTableCols("likes");
  if (!cols.includes(target.column)) {
    const error = new Error(
      "The likes table does not support reel likes; add the reel_id column and make post_id nullable.",
    );
    error.code = "REEL_LIKES_MIGRATION_REQUIRED";
    throw error;
  }
  await db.query(
    `DELETE FROM likes WHERE user_id = ? AND ${target.column} = ?`,
    [userId, target.id],
  );
}

async function updatePostCaption(postId, userId, caption) {
  const [result] = await db.query(
    "UPDATE posts SET caption = ? WHERE id = ? AND user_id = ?",
    [caption, postId, userId],
  );
  if (result.affectedRows > 0) return true;

  const [posts] = await db.query(
    "SELECT id FROM posts WHERE id = ? AND user_id = ?",
    [postId, userId],
  );
  return posts.length > 0;
}

async function deletePost(postId, userId) {
  const connection = await db.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [posts] = await connection.query(
      "SELECT id FROM posts WHERE id = ? AND user_id = ? FOR UPDATE",
      [postId, userId],
    );
    if (posts.length === 0) {
      await connection.rollback();
      return false;
    }

    await connection.query("DELETE FROM likes WHERE post_id = ?", [postId]);
    await connection.query("DELETE FROM comments WHERE post_id = ?", [postId]);
    const [result] = await connection.query(
      "DELETE FROM posts WHERE id = ? AND user_id = ?",
      [postId, userId],
    );
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createComment(
  userId,
  postId,
  comment,
  reelId = null,
  parentCommentId = null,
) {
  const cols = await getTableCols("comments");
  const valueColumns = [
    cols.includes("userId") ? "userId" : "user_id",
    cols.includes("postId") ? "postId" : "post_id",
    "comment",
  ];
  const values = [userId, postId, comment];

  if (reelId) {
    const reelIdCol = cols.includes("reelId") ? "reelId" : "reel_id";
    if (!cols.includes(reelIdCol)) {
      throw new Error("Comments table does not support reel comments");
    }
    valueColumns.splice(1, 1, reelIdCol);
    values.splice(1, 1, reelId);
  }
  if (parentCommentId !== null) {
    if (!cols.includes("parent_comment_id")) {
      const error = new Error(
        "Nested comments require the comments parent_comment_id migration",
      );
      error.code = "NESTED_COMMENTS_MIGRATION_REQUIRED";
      throw error;
    }
    valueColumns.push("parent_comment_id");
    values.push(parentCommentId);
  }

  const [result] = await db.query(
    `INSERT INTO comments (${valueColumns.join(", ")}) VALUES (${valueColumns.map(() => "?").join(", ")})`,
    values,
  );
  return result.insertId;
}

async function getCommentProfileImageSelect() {
  const userCols = await getTableCols("users");
  const profileColumn = userCols.includes("profileImage")
    ? "profileImage"
    : userCols.includes("profile_image")
      ? "profile_image"
      : null;
  return profileColumn ? `u.${profileColumn} AS profileImage` : "NULL AS profileImage";
}

async function getCommentsByPostId(postId, viewerId = null) {
  const profileImageSelect = await getCommentProfileImageSelect();
  const [rows] = await db.query(
    `SELECT c.*, u.username, ${profileImageSelect}, u.full_name,
            (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) AS likesCount,
            EXISTS (SELECT 1 FROM comment_likes WHERE comment_id = c.id AND user_id = ?) AS isLiked
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.post_id = ?
     ORDER BY c.id DESC`,
    [viewerId, postId],
  );
  return rows;
}

async function getCommentsByReelId(reelId, viewerId = null) {
  const profileImageSelect = await getCommentProfileImageSelect();
  const [rows] = await db.query(
    `SELECT c.*, u.username, ${profileImageSelect}, u.full_name,
            (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) AS likesCount,
            EXISTS (SELECT 1 FROM comment_likes WHERE comment_id = c.id AND user_id = ?) AS isLiked
     FROM comments c
     JOIN users u ON (c.userId = u.id OR c.user_id = u.id)
     WHERE c.reelId = ? OR c.reel_id = ?
     ORDER BY c.id DESC`,
    [viewerId, reelId, reelId],
  );
  return rows;
}

// --- Reels ---
async function createReel(userId, videoUrl, caption, songId) {
  const [result] = await db.query(
    `INSERT INTO reels (user_id, video_url, caption, song_name) VALUES (?, ?, ?, ?)`,
    [userId, videoUrl, caption || null, songId || null],
  );
  return result.insertId;
}

async function getReels(limit = 10, offset = 0) {
  const [rows] = await db.query(
    `SELECT r.*, u.username, u.full_name AS name, u.profileImage AS profile_image
     FROM reels r
     JOIN users u ON r.user_id = u.id
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map((r) => ({
    ...r,
    userId: r.user_id,
    videoUrl: r.video_url,
    profileImage: r.profile_image || "",
  }));
}

async function getReelById(reelId) {
  const [rows] = await db.query(
    `SELECT r.*, u.username, u.full_name AS name,
            u.profileImage AS profile_image
     FROM reels r
     JOIN users u ON u.id = r.user_id
     WHERE r.id = ?`,
    [reelId],
  );
  const reel = rows[0];
  if (!reel) return null;
  return {
    ...reel,
    userId: reel.user_id,
    videoUrl: reel.video_url,
    profileImage: reel.profile_image || "",
  };
}

async function getReelsByUserId(userId) {
  const [rows] = await db.query(
    `SELECT r.*, u.username, u.full_name AS name, u.profileImage AS profile_image
     FROM reels r
     JOIN users u ON r.user_id = u.id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    ...r,
    userId: r.user_id,
    videoUrl: r.video_url,
    profileImage: r.profile_image || "",
  }));
}

async function deleteReel(reelId, userId) {
  const [result] = await db.query(
    `DELETE FROM reels WHERE id = ? AND user_id = ?`,
    [reelId, userId],
  );
  return result.affectedRows > 0;
}

// --- Stories ---
async function createStory(
  userId,
  mediaUrl,
  mediaType,
  caption,
  expiresAt,
  options = {},
) {
  const cols = await getTableCols("stories");
  const requiredColumns = [
    "user_id",
    "media_url",
    "media_type",
    "caption",
    "expires_at",
  ];
  const missingColumns = requiredColumns.filter(
    (column) => !cols.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new Error(
      `Stories table is missing required columns: ${missingColumns.join(", ")}`,
    );
  }

  const storyColumns = [
    "user_id",
    "media_url",
    "media_type",
    "caption",
    "expires_at",
    "layers",
    "selected_music",
    "is_ai_generated",
    "audience",
    "allow_replies",
    "allow_sharing",
    "alt_text",
  ];
  const storyValues = [
    userId,
    mediaUrl,
    mediaType,
    caption,
    expiresAt,
    JSON.stringify(options.layers || []),
    options.selectedMusic || null,
    Boolean(options.isAiGenerated),
    options.audience || "followers",
    options.allowReplies !== false,
    options.allowSharing !== false,
    options.altText || null,
  ];
  const [result] = await db.query(
    `INSERT INTO stories (${storyColumns.join(", ")}) VALUES (${storyColumns.map(() => "?").join(", ")})`,
    storyValues,
  );
  const hiddenIds = [...new Set((options.hideFromUserIds || []).map(Number))];
  if (hiddenIds.length) {
    await db.query(
      `INSERT INTO story_hidden_users (story_id, user_id)
       VALUES ${hiddenIds.map(() => "(?, ?)").join(", ")}`,
      hiddenIds.flatMap((hiddenId) => [result.insertId, hiddenId]),
    );
  }
  const mentionIds = [...new Set((options.mentions || []).map(Number))];
  if (mentionIds.length) {
    await db.query(
      `INSERT INTO story_mentions (story_id, user_id)
       VALUES ${mentionIds.map(() => "(?, ?)").join(", ")}`,
      mentionIds.flatMap((mentionedId) => [result.insertId, mentionedId]),
    );
    for (const mentionedId of mentionIds) {
      await notificationModel.createNotification(
        mentionedId,
        userId,
        "mention",
        "story",
        result.insertId,
      );
    }
  }
  return result.insertId;
}

async function getActiveStories(viewerId) {
  const storyCols = await getTableCols("stories");
  const requiredColumns = [
    "id",
    "user_id",
    "media_url",
    "media_type",
    "expires_at",
    "created_at",
  ];
  const missingColumns = requiredColumns.filter(
    (column) => !storyCols.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new Error(
      `Stories table is missing required columns: ${missingColumns.join(", ")}`,
    );
  }

  const userCols = await getTableCols("users");
  if (!userCols.includes("username")) {
    throw new Error("Users table is missing required column: username");
  }
  const profileImageColumn = userCols.includes("profile_image")
    ? "profile_image"
    : userCols.includes("profileImage")
      ? "profileImage"
      : null;
  const profileImageSelect = profileImageColumn
    ? `u.${profileImageColumn}`
    : "NULL";
  const nameColumn = userCols.includes("full_name")
    ? "full_name"
    : userCols.includes("name")
      ? "name"
      : null;
  const nameSelect = nameColumn ? `u.${nameColumn}` : "''";

  const [rows] = await db.query(
    `SELECT s.*, u.username, ${nameSelect} AS name,
            ${profileImageSelect} AS profile_image,
            (SELECT COUNT(*) FROM story_likes sl
             WHERE sl.story_id = s.id) AS likesCount,
            (SELECT COUNT(*) FROM story_views sv
             WHERE sv.story_id = s.id) AS viewsCount,
            EXISTS (SELECT 1 FROM story_views viewer
                    WHERE viewer.story_id = s.id AND viewer.user_id = ?) AS viewed,
            EXISTS (SELECT 1 FROM story_likes viewer_like
                    WHERE viewer_like.story_id = s.id
                      AND viewer_like.user_id = ?) AS isLiked,
            (SELECT JSON_ARRAYAGG(sm.user_id)
             FROM story_mentions sm WHERE sm.story_id = s.id) AS mentions
     FROM stories s
     JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > NOW()
       AND s.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       AND (
         s.user_id = ?
         OR (
           EXISTS (SELECT 1 FROM follows f
                   WHERE f.follower_id = ? AND f.following_id = s.user_id)
           AND (
             COALESCE(s.audience, 'followers') = 'followers'
             OR EXISTS (SELECT 1 FROM close_friends cf
                        WHERE cf.user_id = s.user_id AND cf.friend_id = ?)
           )
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM story_hidden_users shu
         WHERE shu.story_id = s.id AND shu.user_id = ?
       )
     ORDER BY s.created_at DESC, s.id DESC`,
    [viewerId, viewerId, viewerId, viewerId, viewerId, viewerId],
  );
  const storyIds = rows.map((story) => story.id);
  const viewerRows = await getStoryViewerRows(storyIds, userCols);
  const viewersByStoryId = new Map();
  for (const viewer of viewerRows) {
    const viewers = viewersByStoryId.get(Number(viewer.storyId)) || [];
    viewers.push(mapStoryViewer(viewer));
    viewersByStoryId.set(Number(viewer.storyId), viewers);
  }

  return rows.map((story) => ({
    ...story,
    id: story.id,
    userId: story.user_id,
    username: story.username || "",
    profileImage: story.profile_image || "",
    mediaUrl: story.media_url,
    mediaType: story.media_type,
    createdAt: story.created_at,
    expiresAt: story.expires_at,
    viewed: Boolean(Number(story.viewed)),
    isLiked: Boolean(Number(story.isLiked)),
    likesCount: Number(story.likesCount) || 0,
    viewsCount: Number(story.viewsCount) || 0,
    viewers: viewersByStoryId.get(Number(story.id)) || [],
  }));
}

function mapStoryViewer(viewer) {
  return {
    id: viewer.id,
    name: viewer.name || "",
    username: viewer.username || "",
    profileImage: viewer.profileImage || "",
    viewedAt: viewer.viewedAt,
    liked: Boolean(Number(viewer.liked)),
  };
}

async function getStoryViewerRows(storyIds, userCols) {
  if (storyIds.length === 0) return [];

  const nameColumn = userCols.includes("full_name")
    ? "full_name"
    : userCols.includes("name")
      ? "name"
      : null;
  const profileImageColumn = userCols.includes("profile_image")
    ? "profile_image"
    : userCols.includes("profileImage")
      ? "profileImage"
      : null;
  const nameSelect = nameColumn ? `u.${nameColumn}` : "''";
  const profileImageSelect = profileImageColumn
    ? `u.${profileImageColumn}`
    : "NULL";
  const [rows] = await db.query(
    `SELECT sv.story_id AS storyId, u.id, ${nameSelect} AS name,
            u.username, ${profileImageSelect} AS profileImage,
            sv.viewed_at AS viewedAt,
            EXISTS (SELECT 1 FROM story_likes sl
                    WHERE sl.story_id = sv.story_id
                      AND sl.user_id = u.id) AS liked
     FROM story_views sv
     JOIN users u ON u.id = sv.user_id
     WHERE sv.story_id IN (${storyIds.map(() => "?").join(", ")})
     ORDER BY sv.viewed_at DESC`,
    storyIds,
  );
  return rows;
}

async function getStoryViewers(storyId, requesterId, isAdmin = false) {
  const [stories] = await db.query(
    `SELECT user_id AS ownerId FROM stories
     WHERE id = ? AND expires_at > NOW()
       AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [storyId],
  );
  if (!stories[0]) return null;
  if (!isAdmin && Number(stories[0].ownerId) !== Number(requesterId)) {
    return false;
  }

  const userCols = await getTableCols("users");
  const rows = await getStoryViewerRows([storyId], userCols);
  return rows.map(mapStoryViewer);
}

async function markStoryViewed(storyId, viewerId) {
  const [rows] = await db.query(
    `SELECT id, user_id FROM stories
     WHERE id = ? AND expires_at > NOW()
       AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [storyId],
  );
  if (!rows[0]) return false;
  await db.query(
    "INSERT IGNORE INTO story_views (story_id, user_id) VALUES (?, ?)",
    [storyId, viewerId],
  );
  return true;
}

async function getStoryLikeStatus(storyId, userId) {
  const [rows] = await db.query(
    `SELECT s.user_id AS ownerId, sl.user_id AS likedByUser,
            (SELECT COUNT(*) FROM story_likes count_likes
             WHERE count_likes.story_id = s.id) AS likesCount
     FROM stories s
     LEFT JOIN story_likes sl
       ON sl.story_id = s.id AND sl.user_id = ?
     WHERE s.id = ? AND s.expires_at > NOW()
       AND s.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [userId, storyId],
  );
  return rows[0] || null;
}

async function createStoryLike(storyId, userId) {
  await db.query(
    "INSERT INTO story_likes (story_id, user_id) VALUES (?, ?)",
    [storyId, userId],
  );
}

async function deleteStoryLike(storyId, userId) {
  await db.query(
    "DELETE FROM story_likes WHERE story_id = ? AND user_id = ?",
    [storyId, userId],
  );
}

async function deleteStory(storyId, userId, isAdmin = false) {
  const [result] = await db.query(
    isAdmin
      ? "DELETE FROM stories WHERE id = ?"
      : "DELETE FROM stories WHERE id = ? AND user_id = ?",
    isAdmin ? [storyId] : [storyId, userId],
  );
  if (result.affectedRows > 0) return "deleted";

  const [stories] = await db.query("SELECT id FROM stories WHERE id = ?", [
    storyId,
  ]);
  if (stories.length === 0) return "not_found";
  return "forbidden";
}

async function requireMessageColumns() {
  const columns = await getTableCols("messages");
  const requiredColumns = [
    "id",
    "sender_id",
    "receiver_id",
    "message",
    "message_type",
    "media_url",
    "is_read",
    "created_at",
  ];
  const missingColumns = requiredColumns.filter(
    (column) => !columns.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new Error(
      `Messages table is missing required columns: ${missingColumns.join(", ")}`,
    );
  }
  return columns;
}

function mapMessage(row) {
  return {
    id: row.id,
    senderId: row.senderId ?? row.sender_id,
    receiverId: row.receiverId ?? row.receiver_id,
    message: row.message,
    messageType: row.messageType ?? row.message_type,
    mediaUrl: row.mediaUrl ?? row.media_url ?? null,
    reelId: row.reelId ?? row.reel_id ?? null,
    reelVideoUrl: row.reelVideoUrl ?? row.reel_video_url ?? null,
    reelCaption: row.reelCaption ?? row.reel_caption ?? null,
    reelOwnerId: row.reelOwnerId ?? row.reel_owner_id ?? null,
    reelOwnerUsername: row.reelOwnerUsername ?? row.reel_owner_username ?? null,
    postId: row.postId ?? row.post_id ?? null,
    postImageUrl: row.postImageUrl ?? row.post_image_url ?? null,
    postCaption: row.postCaption ?? row.post_caption ?? null,
    postOwnerUsername: row.postOwnerUsername ?? row.post_owner_username ?? null,
    clientMessageId: row.clientMessageId ?? row.client_message_id ?? null,
    isRead: row.isRead ?? row.is_read,
    readAt: row.readAt ?? row.read_at ?? null,
    createdAt: row.createdAt ?? row.created_at,
  };
}

async function getMessageById(messageId, columns) {
  const reelFields = columns.includes("reel_id")
    ? `m.reel_id AS reelId, r.video_url AS reelVideoUrl,
       r.caption AS reelCaption, r.user_id AS reelOwnerId,
       owner.username AS reelOwnerUsername`
    : `NULL AS reelId, NULL AS reelVideoUrl,
       NULL AS reelCaption, NULL AS reelOwnerId,
       NULL AS reelOwnerUsername`;
  const postFields = columns.includes("post_id")
    ? `m.post_id AS postId, m.post_image_url AS postImageUrl,
       m.post_caption AS postCaption, m.post_owner_username AS postOwnerUsername`
    : `NULL AS postId, NULL AS postImageUrl, NULL AS postCaption, NULL AS postOwnerUsername`;
  const reelJoins = columns.includes("reel_id")
    ? `LEFT JOIN reels r ON r.id = m.reel_id
       LEFT JOIN users owner ON owner.id = r.user_id`
    : "";
  const clientIdField = columns.includes("client_message_id")
    ? "m.client_message_id AS clientMessageId"
    : "NULL AS clientMessageId";
  const readAtField = columns.includes("read_at")
    ? "m.read_at AS readAt"
    : "NULL AS readAt";
  const [rows] = await db.query(
    `SELECT m.id, m.sender_id AS senderId, m.receiver_id AS receiverId,
            m.message, m.message_type AS messageType,
            m.media_url AS mediaUrl, ${reelFields}, ${postFields}, ${clientIdField},
            m.is_read AS isRead, ${readAtField}, m.created_at AS createdAt
     FROM messages m
     ${reelJoins}
     WHERE m.id = ?`,
    [messageId],
  );
  return rows[0] ? mapMessage(rows[0]) : null;
}

// Persist a message using the authenticated sender and the verified messages schema.
async function createMessage(
  senderId,
  receiverId,
  message,
  messageType,
  mediaUrl,
  reelId = null,
  clientMessageId = null,
  postId = null,
  postImageUrl = null,
  postCaption = null,
  postOwnerUsername = null,
) {
  if (!MESSAGE_TYPES.has(messageType)) {
    const error = new Error("Unsupported message type");
    error.code = "INVALID_MESSAGE_TYPE";
    throw error;
  }

  const columns = await requireMessageColumns();
  if (clientMessageId && !columns.includes("client_message_id")) {
    const error = new Error(
      "Offline message delivery requires the approved client_message_id database migration",
    );
    error.code = "CHAT_IDEMPOTENCY_MIGRATION_REQUIRED";
    throw error;
  }
  if (clientMessageId) {
    const [existing] = await db.query(
      `SELECT id FROM messages
       WHERE sender_id = ? AND client_message_id = ? LIMIT 1`,
      [senderId, clientMessageId],
    );
    if (existing[0]) {
      return getMessageById(existing[0].id, columns);
    }
  }
  if (messageType === "reel" && !columns.includes("reel_id")) {
    const error = new Error(
      "Shared reel messages require the approved messages.reel_id migration",
    );
    error.code = "REEL_MESSAGE_MIGRATION_REQUIRED";
    throw error;
  }
  if ((messageType === "reel") !== (reelId !== null && reelId !== undefined)) {
    const error = new Error("A reelId is required only for reel messages");
    error.code = "INVALID_REEL_MESSAGE";
    throw error;
  }
  if (messageType === "post") {
    const postColumns = [
      "post_id",
      "post_image_url",
      "post_caption",
      "post_owner_username",
    ];
    if (postColumns.some((column) => !columns.includes(column))) {
      const error = new Error(
        "Shared post messages require the chat messages migration",
      );
      error.code = "POST_MESSAGE_MIGRATION_REQUIRED";
      throw error;
    }
    if (!Number.isSafeInteger(Number(postId)) || Number(postId) <= 0) {
      const error = new Error("A postId is required for post messages");
      error.code = "INVALID_POST_MESSAGE";
      throw error;
    }
    const [posts] = await db.query("SELECT id FROM posts WHERE id = ?", [
      postId,
    ]);
    if (!posts[0]) {
      const error = new Error("Post not found");
      error.code = "SHARED_POST_NOT_FOUND";
      throw error;
    }
  } else if (postId !== null && postId !== undefined) {
    const error = new Error("A postId is allowed only for post messages");
    error.code = "INVALID_POST_MESSAGE";
    throw error;
  }
  if (messageType === "reel") {
    const [reels] = await db.query(`SELECT id FROM reels WHERE id = ?`, [
      reelId,
    ]);
    if (reels.length === 0) {
      const error = new Error("Reel not found");
      error.code = "SHARED_REEL_NOT_FOUND";
      throw error;
    }
  }

  const insertColumns = [
    "sender_id",
    "receiver_id",
    "message",
    "message_type",
    "media_url",
  ];
  const insertValues = [
    senderId,
    receiverId,
    message,
    messageType,
    mediaUrl || null,
  ];
  if (columns.includes("reel_id")) {
    insertColumns.push("reel_id");
    insertValues.push(reelId || null);
  }
  if (columns.includes("post_id") && postId != null) {
    insertColumns.push("post_id");
    insertValues.push(postId);
  }
  if (columns.includes("post_image_url")) {
    insertColumns.push("post_image_url");
    insertValues.push(postImageUrl);
  }
  if (columns.includes("post_caption")) {
    insertColumns.push("post_caption");
    insertValues.push(postCaption);
  }
  if (columns.includes("post_owner_username")) {
    insertColumns.push("post_owner_username");
    insertValues.push(postOwnerUsername);
  }
  if (clientMessageId) {
    insertColumns.push("client_message_id");
    insertValues.push(clientMessageId);
  }
  let result;
  try {
    [result] = await db.query(
      `INSERT INTO messages (${insertColumns.join(", ")})
       VALUES (${insertValues.map(() => "?").join(", ")})`,
      insertValues,
    );
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY" || !clientMessageId) throw error;
    const [existing] = await db.query(
      `SELECT id FROM messages
       WHERE sender_id = ? AND client_message_id = ? LIMIT 1`,
      [senderId, clientMessageId],
    );
    if (existing[0]) {
      return getMessageById(existing[0].id, columns);
    }
    throw error;
  }

  const createdMessage = await getMessageById(result.insertId, columns);
  if (!createdMessage) {
    throw new Error(
      "The saved message could not be read back from the database",
    );
  }
  return createdMessage;
}

// Omitted pagination options retain the original full chronological response.
async function getMessages(userId, otherUserId, pagination = null) {
  const columns = await requireMessageColumns();
  const reelFields = columns.includes("reel_id")
    ? `m.reel_id AS reelId, r.video_url AS reelVideoUrl,
       r.caption AS reelCaption, r.user_id AS reelOwnerId,
       owner.username AS reelOwnerUsername`
    : `NULL AS reelId, NULL AS reelVideoUrl,
       NULL AS reelCaption, NULL AS reelOwnerId,
       NULL AS reelOwnerUsername`;
  const postFields = columns.includes("post_id")
    ? `m.post_id AS postId, m.post_image_url AS postImageUrl,
       m.post_caption AS postCaption, m.post_owner_username AS postOwnerUsername`
    : `NULL AS postId, NULL AS postImageUrl, NULL AS postCaption, NULL AS postOwnerUsername`;
  const reelJoins = columns.includes("reel_id")
    ? `LEFT JOIN reels r ON r.id = m.reel_id
       LEFT JOIN users owner ON owner.id = r.user_id`
    : "";
  const clientIdField = columns.includes("client_message_id")
    ? "m.client_message_id AS clientMessageId"
    : "NULL AS clientMessageId";
  const readAtField = columns.includes("read_at")
    ? "m.read_at AS readAt"
    : "NULL AS readAt";
  const paginated = pagination !== null;
  const beforeFilter = paginated && pagination.beforeId ? "AND m.id < ?" : "";
  const order = paginated
    ? "ORDER BY m.id DESC"
    : "ORDER BY m.created_at ASC, m.id ASC";
  const queryParams = [userId, otherUserId, otherUserId, userId];
  if (beforeFilter) queryParams.push(pagination.beforeId);
  if (paginated) queryParams.push(pagination.limit + 1);
  const [rows] = await db.query(
    `SELECT m.id, m.sender_id AS senderId, m.receiver_id AS receiverId,
            m.message, m.message_type AS messageType,
            m.media_url AS mediaUrl, ${reelFields}, ${postFields}, ${clientIdField},
            m.is_read AS isRead, ${readAtField}, m.created_at AS createdAt
     FROM messages m
     ${reelJoins}
        WHERE ((m.sender_id = ? AND m.receiver_id = ?)
          OR (m.sender_id = ? AND m.receiver_id = ?))
         ${beforeFilter}
     ${order}
     ${paginated ? "LIMIT ?" : ""}`,
    queryParams,
  );
  if (!paginated) return rows.map(mapMessage);
  const hasMore = rows.length > pagination.limit;
  return {
    messages: rows.slice(0, pagination.limit).map(mapMessage),
    hasMore,
  };
}

async function markMessagesRead(userId, senderId) {
  const columns = await requireMessageColumns();
  const readAtUpdate = columns.includes("read_at")
    ? ", read_at = CURRENT_TIMESTAMP"
    : "";
  const [result] = await db.query(
    `UPDATE messages SET is_read = 1${readAtUpdate}
     WHERE receiver_id = ? AND sender_id = ? AND is_read = 0`,
    [userId, senderId],
  );
  return result.affectedRows;
}

// Return the newest message for each conversation, with its other participant.
async function getConversations(userId) {
  await requireMessageColumns();
  const userCols = await getTableCols("users");
  if (!userCols.includes("username")) {
    throw new Error("Users table is missing required column: username");
  }
  const nameColumn = userCols.includes("full_name")
    ? "full_name"
    : userCols.includes("name")
      ? "name"
      : null;
  const profileImageColumn = userCols.includes("profile_image")
    ? "profile_image"
    : userCols.includes("profileImage")
      ? "profileImage"
      : null;
  const nameSelect = nameColumn ? `u.${nameColumn}` : "''";
  const profileImageSelect = profileImageColumn
    ? `u.${profileImageColumn}`
    : "NULL";

  const [rows] = await db.query(
    `SELECT m.id, m.sender_id AS senderId, m.receiver_id AS receiverId,
            m.message, m.message_type AS messageType,
            m.media_url AS mediaUrl, m.is_read AS isRead,
            m.created_at AS createdAt,
            u.id AS conversationUserId, u.username,
            ${nameSelect} AS name, ${profileImageSelect} AS profileImage
     FROM messages m
     JOIN users u
       ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
     WHERE (m.sender_id = ? OR m.receiver_id = ?)
       AND NOT EXISTS (
         SELECT 1
         FROM messages newer
         WHERE ((newer.sender_id = m.sender_id AND newer.receiver_id = m.receiver_id)
             OR (newer.sender_id = m.receiver_id AND newer.receiver_id = m.sender_id))
           AND (COALESCE(newer.created_at, '1000-01-01 00:00:00')
                  > COALESCE(m.created_at, '1000-01-01 00:00:00')
             OR (COALESCE(newer.created_at, '1000-01-01 00:00:00')
                  = COALESCE(m.created_at, '1000-01-01 00:00:00')
                 AND newer.id > m.id))
       )
     ORDER BY m.created_at DESC, m.id DESC`,
    [userId, userId, userId],
  );
  return rows.map((row) => ({
    ...mapMessage(row),
    conversationUserId: row.conversationUserId,
    username: row.username,
    name: row.name || "",
    profileImage: row.profileImage || "",
  }));
}

module.exports = {
  createPost,
  getPostById,
  getFeed,
  getPostsByUserId,
  getLike,
  getContentOwner,
  createLike,
  deleteLike,
  updatePostCaption,
  deletePost,
  createComment,
  getCommentsByPostId,
  getCommentsByReelId,
  createReel,
  getReels,
  getReelById,
  getReelsByUserId,
  deleteReel,
  createStory,
  getActiveStories,
  getStoryViewers,
  markStoryViewed,
  getStoryLikeStatus,
  createStoryLike,
  deleteStoryLike,
  deleteStory,
  createMessage,
  getMessages,
  markMessagesRead,
  getConversations,
};
