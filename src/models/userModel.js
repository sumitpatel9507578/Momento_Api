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

  let query = `INSERT INTO users (username, email, password`;
  const params = [username, email, password];

  if (nameCol) {
    query += `, ${nameCol}`;
    params.push(name);
  }
  if (imgCol) {
    query += `, ${imgCol}`;
    params.push(profileImage);
  }

  query += `) VALUES (?, ?, ?, ?, ?)`.replace(
    ", ?, ?)",
    nameCol && imgCol ? ", ?, ?)" : nameCol || imgCol ? ", ?)" : ")",
  );

  // Fix the placeholder count dynamically
  const placeholders = params.map(() => "?").join(", ");
  const finalQuery = `INSERT INTO users (username, email, password${nameCol ? ", " + nameCol : ""}${imgCol ? ", " + imgCol : ""}) VALUES (${placeholders})`;

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
    if (key === "profileImage")
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

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  getUserByUsername,
  searchUsers,
  updateUser,
};
