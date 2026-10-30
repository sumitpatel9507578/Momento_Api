const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

function signAdmin(user) {
  if (!process.env.JWT_SECRET) {
    const error = new Error("JWT_SECRET is missing");
    error.statusCode = 500;
    throw error;
  }
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: process.env.ADMIN_TOKEN_EXPIRES_IN || "1d" },
  );
}

function validRegistrationCode(supplied) {
  if (!process.env.ADMIN_REGISTRATION_CODE) return false;
  const expected = Buffer.from(String(process.env.ADMIN_REGISTRATION_CODE));
  const provided = Buffer.from(String(supplied || ""));
  return (
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided)
  );
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Server authentication is not configured",
      });
    }

    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || typeof password !== "string" || !password) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }
    const [rows] = await db.query(
      `SELECT id, username, full_name, email, password, role, is_blocked, status, is_active
       FROM users WHERE LOWER(email) = ? LIMIT 1`,
      [normalizedEmail],
    );
    const admin = rows[0];
    const accountBlocked =
      !admin ||
      Number(admin.is_blocked) === 1 ||
      Number(admin.is_active) === 0 ||
      String(admin.status || "").toLowerCase() === "blocked";
    if (
      accountBlocked ||
      String(admin.role || "").toLowerCase() !== "admin" ||
      !(await bcrypt.compare(password, admin.password))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }
    const token = signAdmin(admin);

    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      data: {
        token,
        user: {
          id: admin.id,
          username: admin.username,
          fullName: admin.full_name || "",
          email: admin.email,
          role: "admin",
        },
      },
    });
  } catch (error) {
    console.error("Admin login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to log in",
    });
  }
}

async function register(req, res) {
  try {
    const { username, email, password, fullName, full_name } = req.body || {};
    if (!process.env.ADMIN_REGISTRATION_CODE) {
      return res.status(500).json({ success: false, message: "Admin registration is not configured" });
    }
    if (!validRegistrationCode(req.body?.adminCode || req.body?.registrationCode)) {
      return res.status(403).json({ success: false, message: "Invalid admin registration code" });
    }
    if (
      typeof username !== "string" ||
      !username.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return res.status(400).json({ success: false, message: "Valid username, email and an 8-character password are required" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();
    const [existing] = await db.query(
      "SELECT id FROM users WHERE LOWER(email) = ? OR username = ? LIMIT 1",
      [normalizedEmail, normalizedUsername],
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: "Email or username already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const [columns] = await db.query("SHOW COLUMNS FROM users");
    const available = new Set(columns.map((column) => column.Field));
    const fields = ["username", "email", "password", "role"];
    const values = [normalizedUsername, normalizedEmail, hashedPassword, "admin"];
    if (available.has("full_name")) {
      fields.push("full_name");
      values.push(fullName || full_name || normalizedUsername);
    } else if (available.has("name")) {
      fields.push("name");
      values.push(fullName || full_name || normalizedUsername);
    }
    if (available.has("status")) { fields.push("status"); values.push("active"); }
    if (available.has("is_active")) { fields.push("is_active"); values.push(1); }
    if (available.has("is_blocked")) { fields.push("is_blocked"); values.push(0); }
    const placeholders = fields.map(() => "?").join(", ");
    const [result] = await db.query(
      `INSERT INTO users (${fields.join(", ")}) VALUES (${placeholders})`,
      values,
    );
    const admin = { id: result.insertId, username: normalizedUsername, email: normalizedEmail };
    return res.status(201).json({
      success: true,
      message: "Admin registered successfully",
      data: { token: signAdmin(admin), user: { ...admin, role: "admin" } },
    });
  } catch (error) {
    console.error("Admin registration error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Unable to register admin",
    });
  }
}

async function profile(req, res) {
  const [rows] = await db.query(
    `SELECT id, username, full_name, email, profileImage, bio, role, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [req.user.id],
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: "Admin profile not found" });
  const user = rows[0];
  return res.json({ success: true, data: {
    id: user.id, username: user.username, fullName: user.full_name || "",
    email: user.email, profileImage: user.profileImage || "",
    bio: user.bio || "", role: "admin", createdAt: user.created_at || null,
  } });
}

async function updateProfile(req, res) {
  const allowed = ["fullName", "full_name", "username", "email", "bio", "profileImage", "profile_image"];
  const [columns] = await db.query("SHOW COLUMNS FROM users");
  const available = new Set(columns.map((column) => column.Field));
  const fields = [];
  const values = [];
  const mappings = {
    fullName: "full_name", full_name: "full_name", username: "username", email: "email", bio: "bio",
    profileImage: "profile_image", profile_image: "profile_image",
  };
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    const column = mappings[key];
    if (column && available.has(column)) {
      fields.push(`${column} = ?`);
      values.push(String(req.body[key]).trim());
    } else if (column === "profile_image" && available.has("profileImage")) {
      fields.push("profileImage = ?");
      values.push(String(req.body[key]).trim());
    }
  }
  if (!fields.length) return res.status(400).json({ success: false, message: "No supported profile fields provided" });
  values.push(req.user.id);
  await db.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
  return profile(req, res);
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: "Current password and a new password of at least 8 characters are required" });
  }
  const [rows] = await db.query("SELECT password FROM users WHERE id = ? LIMIT 1", [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password))) {
    return res.status(401).json({ success: false, message: "Current password is incorrect" });
  }
  await db.query("UPDATE users SET password = ? WHERE id = ?", [await bcrypt.hash(newPassword, 12), req.user.id]);
  return res.json({ success: true, message: "Password changed successfully" });
}

module.exports = { login, register, profile, updateProfile, changePassword, signAdmin };
