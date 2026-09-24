const db = require("../config/db");

// Diagnostic: Get table structure to log on server start
async function getTableInfo() {
  try {
    const [columns] = await db.query("SHOW COLUMNS FROM users");
    console.log(
      "[DIAGNOSTIC] 'users' table columns:",
      columns.map((c) => c.Field).join(", "),
    );
    return columns.map((c) => c.Field);
  } catch (err) {
    console.error("[DIAGNOSTIC] Failed to get table info:", err.message);
    return [];
  }
}

// Create a user record with fallback for column names
async function createUser(
  username,
  email,
  password,
  name = null,
  profileImage = null,
  deviceToken = null,
) {
  const cols = await getTableInfo();

  // Decide which name column to use
  const nameCol = cols.includes("full_name")
    ? "full_name"
    : cols.includes("name")
      ? "name"
      : null;
  const imgCol = cols.includes("profile_image")
    ? "profile_image"
    : cols.includes("profileImage")
      ? "profileImage"
      : null;

  const insertColumns = ["username", "email", "password"];
  const params = [username, email, password];

  if (nameCol) {
    insertColumns.push(nameCol);
    params.push(name);
  }
  if (imgCol) {
    insertColumns.push(imgCol);
    params.push(profileImage);
  }

  if (cols.includes("device_token")) {
    insertColumns.push("device_token");
    params.push(deviceToken);
  }

  const placeholders = params.map(() => "?").join(", ");
  const finalQuery = `INSERT INTO users (${insertColumns.join(", ")}) VALUES (${placeholders})`;

  const [result] = await db.query(finalQuery, params);
  return result.insertId;
}

async function getUserByEmail(email) {
  const [rows] = await db.query(`SELECT * FROM users WHERE email = ?`, [email]);
  return rows[0];
}

async function getUserById(id) {
  const [rows] = await db.query(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!rows[0]) return null;

  // Map fields to a standard format for the app
  const user = rows[0];
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.full_name || user.name || "",
    bio: user.bio || "",
    profileImage: user.profile_image || user.profileImage || "",
    role: user.role || "user",
    profileCompleted: Boolean(user.profile_completed),
    createdAt: user.created_at || user.createdAt || null,
  };
}

async function getUserByUsername(username) {
  const [rows] = await db.query(`SELECT * FROM users WHERE username = ?`, [
    username,
  ]);
  return rows[0];
}

async function searchUsers(query) {
  const [rows] = await db.query(
    `SELECT id, username, full_name AS name, profileImage AS profile_image
     FROM users
     WHERE username LIKE ? OR full_name LIKE ?
     LIMIT 20`,
    [`%${query}%`, `%${query}%`],
  );
  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name || "",
    profileImage: user.profile_image || "",
  }));
}

async function updateUser(id, updates) {
  const cols = await getTableInfo();
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    let dbKey = key;
    if (key === "fullName" || key === "name")
      dbKey = cols.includes("full_name") ? "full_name" : "name";
    if (key === "profileImage" || key === "profile_image")
      dbKey = cols.includes("profile_image") ? "profile_image" : "profileImage";

    if (cols.includes(dbKey)) {
      fields.push(`${dbKey} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return null;
  values.push(id);
  const [result] = await db.query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
    values,
  );
  return result.affectedRows > 0;
}

async function saveAuthTokens(id, accessToken, refreshToken, deviceToken) {
  const cols = await getTableInfo();
  const requiredColumns = ["access_token", "refresh_token"];
  const missingColumns = requiredColumns.filter(
    (column) => !cols.includes(column),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `Missing users table columns: ${missingColumns.join(", ")}. Run the user auth migration.`,
    );
  }

  const fields = ["access_token = ?", "refresh_token = ?"];
  const values = [accessToken, refreshToken];

  if (deviceToken !== undefined && cols.includes("device_token")) {
    fields.push("device_token = ?");
    values.push(deviceToken);
  }

  values.push(id);
  const [result] = await db.query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
    values,
  );

  if (result.affectedRows === 0) {
    throw new Error(`Could not save auth tokens for user ${id}.`);
  }

  return true;
}

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  getUserByUsername,
  searchUsers,
  saveAuthTokens,
  updateUser,
};
