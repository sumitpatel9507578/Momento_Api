const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");
const db = require("../config/db");

async function register(req, res) {
  console.log(
    "[AUTH] Register request received:",
    req.body.username || req.body.email,
  );
  try {
    const { username, email, password } = req.body;
    const deviceToken = req.body.deviceToken || req.body.device_token || null;
    let assignedRole = "user";

    // Support all possible name field formats from client (fullName, full_name, name)
    const fullName =
      req.body.fullName || req.body.full_name || req.body.name || "";

    if (
      typeof username !== "string" ||
      !username.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing (username, email, password)",
      });
    }

    if (req.body.registrationType === "admin") {
      const configuredAdminCode = process.env.ADMIN_REGISTRATION_CODE?.trim();
      if (!configuredAdminCode) {
        return res.status(500).json({
          success: false,
          message: "Server configuration error: admin registration is unavailable",
        });
      }

      const suppliedAdminCode =
        typeof req.body.adminCode === "string" ? req.body.adminCode.trim() : "";
      const suppliedCodeBuffer = Buffer.from(suppliedAdminCode);
      const configuredCodeBuffer = Buffer.from(configuredAdminCode);
      const isValidAdminCode =
        suppliedCodeBuffer.length === configuredCodeBuffer.length &&
        crypto.timingSafeEqual(suppliedCodeBuffer, configuredCodeBuffer);

      if (!isValidAdminCode) {
        return res.status(403).json({
          success: false,
          message: "Access denied: Invalid or missing admin authorization code",
        });
      }

      assignedRole = "admin";
    }

    const normalizedEmail = email.trim();
    const normalizedUsername = username.trim();
    const existingUser = await userModel.getUserByEmail(normalizedEmail);
    if (existingUser)
      return res
        .status(400)
        .json({ success: false, message: "Email already taken" });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Support all possible profile image field formats from client
    let profileImage =
      req.body.profileImage ||
      req.body.profile_image ||
      req.body.profileimage ||
      null;
    if (req.file) {
      profileImage = req.file.path;
      console.log("[AUTH] Profile image uploaded:", profileImage);
    }

    const id = await userModel.createUser(
      normalizedUsername,
      normalizedEmail,
      hashedPassword,
      fullName,
      profileImage,
      deviceToken,
      assignedRole,
    );
    console.log("[AUTH] User created in DB with ID:", id);

    const user = await userModel.getUserById(id);
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role || assignedRole,
      },
      process.env.JWT_SECRET || "momento_fallback_secret",
      { expiresIn: "7d" },
    );
    const refreshToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role || assignedRole },
      process.env.JWT_REFRESH_SECRET ||
        process.env.JWT_SECRET ||
        "momento_fallback_secret",
      { expiresIn: "30d" },
    );

    await userModel.saveAuthTokens(id, token, refreshToken, deviceToken);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: { token, refreshToken, user: user },
    });
  } catch (error) {
    console.error("[AUTH] Register Crash:", error);

    // Handle MySQL duplicate entry gracefully
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Email or username already exists",
        error_detail: error.sqlMessage,
      });
    }

    return res.status(500).json({
      success: false,
      message: `Server Error: ${error.message}`,
      error_detail: error.code, // Catches SQL errors like ER_BAD_FIELD_ERROR
    });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const deviceToken = req.body.deviceToken || req.body.device_token;
    const userInDb = await userModel.getUserByEmail(email);

    if (!userInDb)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, userInDb.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const user = await userModel.getUserById(userInDb.id);
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role || "user",
      },
      process.env.JWT_SECRET || "momento_fallback_secret",
      { expiresIn: "7d" },
    );
    const refreshToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role || "user" },
      process.env.JWT_REFRESH_SECRET ||
        process.env.JWT_SECRET ||
        "momento_fallback_secret",
      { expiresIn: "30d" },
    );

    await userModel.saveAuthTokens(user.id, token, refreshToken, deviceToken);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: { token, refreshToken, user: user },
    });
  } catch (error) {
    console.error("[AUTH] Login Crash:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function refresh(req, res) {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== "string" || !refreshToken) {
    return res.status(400).json({ success: false, message: "refreshToken is required" });
  }
  try {
    const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT refresh secret is not configured");
    const decoded = jwt.verify(refreshToken, secret);
    const user = await userModel.getUserById(decoded.id);
    const [rows] = await db.query(
      "SELECT refresh_token FROM users WHERE id = ?",
      [decoded.id],
    );
    if (!user || !rows[0]?.refresh_token || rows[0].refresh_token !== refreshToken) {
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }
    const accessToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role || "user",
      },
      process.env.JWT_SECRET || "momento_fallback_secret",
      { expiresIn: "7d" },
    );
    const rotatedRefreshToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role || "user" },
      secret,
      { expiresIn: "30d" },
    );
    await userModel.saveAuthTokens(user.id, accessToken, rotatedRefreshToken);
    return res.json({
      success: true,
      message: "Token refreshed successfully",
      data: { token: accessToken, refreshToken: rotatedRefreshToken },
    });
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, message: "Invalid or expired refresh token" });
    }
    console.error("Refresh token error:", error);
    return res.status(500).json({ success: false, message: "Failed to refresh token" });
  }
}

async function logout(req, res) {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== "string" || !refreshToken) {
    return res.status(400).json({ success: false, message: "refreshToken is required" });
  }
  try {
    const [result] = await db.query(
      "UPDATE users SET access_token = NULL, refresh_token = NULL WHERE id = ? AND refresh_token = ?",
      [req.user.id, refreshToken],
    );
    if (!result.affectedRows) {
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }
    return res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ success: false, message: "Failed to log out" });
  }
}

async function forgotPassword(req, res) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: "A valid email is required" });
  }
  const deliveryUrl = process.env.PASSWORD_RESET_WEBHOOK_URL;
  if (!deliveryUrl) {
    return res.status(503).json({
      success: false,
      message: "Password reset delivery is not configured",
    });
  }
  let parsedDeliveryUrl;
  try {
    parsedDeliveryUrl = new URL(deliveryUrl);
  } catch {
    return res.status(500).json({ success: false, message: "Password reset delivery is misconfigured" });
  }
  if (process.env.NODE_ENV === "production" && parsedDeliveryUrl.protocol !== "https:") {
    return res.status(500).json({ success: false, message: "Password reset delivery must use HTTPS" });
  }
  try {
    const user = await userModel.getUserByEmail(email);
    if (user) {
      await db.query("DELETE FROM password_reset_tokens WHERE user_id = ?", [user.id]);
      const resetToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
      await db.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
        [user.id, tokenHash],
      );
      try {
        const response = await fetch(parsedDeliveryUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.PASSWORD_RESET_WEBHOOK_SECRET
              ? { Authorization: `Bearer ${process.env.PASSWORD_RESET_WEBHOOK_SECRET}` }
              : {}),
          },
          body: JSON.stringify({ email, resetToken, expiresInMinutes: 60 }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          throw new Error(`Reset delivery returned HTTP ${response.status}`);
        }
      } catch (error) {
        await db.query(
          "DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash = ?",
          [user.id, tokenHash],
        );
        throw error;
      }
    }
    return res.json({
      success: true,
      message: "If an account exists for this email, password reset instructions will be sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(502).json({ success: false, message: "Password reset delivery failed" });
  }
}

async function resetPassword(req, res) {
  const { token, password } = req.body || {};
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({ success: false, message: "A valid reset token is required" });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({ success: false, message: "Password must be between 8 and 128 characters" });
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  let connection;
  let transactionStarted = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND expires_at > NOW() FOR UPDATE`,
      [tokenHash],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Reset token is invalid or expired" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await connection.query(
      "UPDATE users SET password = ?, access_token = NULL, refresh_token = NULL WHERE id = ?",
      [passwordHash, rows[0].user_id],
    );
    await connection.query("DELETE FROM password_reset_tokens WHERE user_id = ?", [rows[0].user_id]);
    await connection.commit();
    return res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Failed to reset password" });
  } finally {
    connection?.release();
  }
}

module.exports = { register, login, refresh, logout, forgotPassword, resetPassword };
