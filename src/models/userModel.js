const db = require("../config/db");

// Create a user record and return its generated id
async function createUser(username, email, password, fullName = null) {
  const [result] = await db.query(
    `INSERT INTO users
    (username, email, password, full_name)
    VALUES (?, ?, ?, ?)`,
    [username, email, password, fullName],
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
      profile_image,
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

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  getUserByUsername,
};
