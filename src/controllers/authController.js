const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");

async function register(req, res) {
  console.log("[AUTH] Register request received:", req.body.username);
  try {
    const { username, email, password, fullName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "Required fields missing" });
    }

    const existingUser = await userModel.getUserByEmail(email);
    if (existingUser) return res.status(400).json({ success: false, message: "Email already taken" });

    const hashedPassword = await bcrypt.hash(password, 10);

    let profileImage = req.body.profileImage || null;
    if (req.file) {
      profileImage = `/uploads/${req.file.filename}`;
      console.log("[AUTH] Profile image uploaded:", profileImage);
    }

    const id = await userModel.createUser(username, email, hashedPassword, fullName, profileImage);
    console.log("[AUTH] User created in DB with ID:", id);

    const user = await userModel.getUserById(id);
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET || 'momento_fallback_secret',
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: { token, user: user },
    });
  } catch (error) {
    console.error("[AUTH] Register Crash:", error);
    return res.status(500).json({
      success: false,
      message: `Server Error: ${error.message}`,
      error_detail: error.code // To catch SQL errors like ER_BAD_FIELD_ERROR
    });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const userInDb = await userModel.getUserByEmail(email);

    if (!userInDb) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, userInDb.password);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const user = await userModel.getUserById(userInDb.id);
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET || 'momento_fallback_secret',
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: { token, user: user },
    });
  } catch (error) {
    console.error("[AUTH] Login Crash:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { register, login };
