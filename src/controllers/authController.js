const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");

async function register(req, res) {
  console.log(
    "[AUTH] Register request received:",
    req.body.username || req.body.email,
  );
  try {
    const { username, email, password } = req.body;
    const deviceToken = req.body.deviceToken || req.body.device_token || null;

    // Support all possible name field formats from client (fullName, full_name, name)
    const fullName =
      req.body.fullName || req.body.full_name || req.body.name || "";

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing (username, email, password)",
      });
    }

    const existingUser = await userModel.getUserByEmail(email);
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
      username,
      email,
      hashedPassword,
      fullName,
      profileImage,
      deviceToken,
    );
    console.log("[AUTH] User created in DB with ID:", id);

    const user = await userModel.getUserById(id);
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET || "momento_fallback_secret",
      { expiresIn: "7d" },
    );
    const refreshToken = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_REFRESH_SECRET ||
        process.env.JWT_SECRET ||
        "momento_fallback_secret",
      { expiresIn: "30d" },
    );

    await userModel.updateUser(id, {
      access_token: token,
      refresh_token: refreshToken,
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: { token, user: user },
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
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET || "momento_fallback_secret",
      { expiresIn: "7d" },
    );
    const refreshToken = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_REFRESH_SECRET ||
        process.env.JWT_SECRET ||
        "momento_fallback_secret",
      { expiresIn: "30d" },
    );

    const tokenUpdates = {
      access_token: token,
      refresh_token: refreshToken,
    };
    if (deviceToken !== undefined) tokenUpdates.device_token = deviceToken;

    const tokensSaved = await userModel.updateUser(user.id, tokenUpdates);
    if (!tokensSaved) {
      console.warn("[AUTH] Login tokens were not saved for user:", user.id);
    }

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

module.exports = { register, login };
