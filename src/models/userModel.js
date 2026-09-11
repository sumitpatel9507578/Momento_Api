const db = require("../config/db");

// Create a user record and return its generated id
async function createUser(username, email, password, fullName = null, profileImage = null) {
  const [result] = await db.query(
    `INSERT INTO users
    (username, email, password, full_name, profileImage)
    VALUES (?, ?, ?, ?, ?)`,
    [username, email, password, fullName, profileImage],
  );

  return result.insertId;
}

// Find a user by email for registration checks and login verification
async function getUserByEmail(email) {
  const [rows] = await db.query(
    `SELECT *
     FROM users
     WHERE email = ?`,
    [email],
  );

  return rows[0];
}

// Find a user by id without returning the password hash
async function getUserById(id) {
  const [rows] = await db.query(
    `SELECT
      id,
      username,
      email,
      full_name,
      bio,
      profileImage,
      is_active,
      created_at,
      updated_at
     FROM users
     WHERE id = ?`,
    [id],
  );

  return rows[0];
}

// Find a user by username for duplicate checks
async function getUserByUsername(username) {
  const [rows] = await db.query(
    `SELECT *
     FROM users
     WHERE username = ?`,
    [username],
  );

  return rows[0];
}

// Search for users by username or full name
async function searchUsers(query) {
  const [rows] = await db.query(
    `SELECT id, username, full_name, profileImage
     FROM users
     WHERE username LIKE ? OR full_name LIKE ?
     LIMIT 20`,
    [`%${query}%`, `%${query}%`],
  );

  return rows;
}

async function updateUser(id, updates) {
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    // Map JS keys to DB keys if necessary
    const dbKey = key === 'fullName' ? 'full_name' : (key === 'profile_image' ? 'profileImage' : key);
    fields.push(`${dbKey} = ?`);
    values.push(value);
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
  updateUser,
};
