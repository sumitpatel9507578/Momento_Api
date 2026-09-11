const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");

// Register a new Momento user and return safe user data
async function register(req, res) {
  try {
    const { username, email, password, fullName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email and password are required",
        data: null,
      });
    }

    const existingEmail = await userModel.getUserByEmail(email);

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
        data: null,
      });
    }

    const existingUsername = await userModel.getUserByUsername(username);

    if (existingUsername) {
      return res.status(400).json({
        success: false,
        message: "Username already exists",
        data: null,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const id = await userModel.createUser(
      username,
      email,
      hashedPassword,
      fullName,
      req.body.profileImage || null
    );

    const user = await userModel.getUserById(id);

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        token,
        user: user,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Registration failed",
      data: null,
    });
  }
}

// Login the user, verify the password and generate a JWT token
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
        data: null,
      });
    }

    const user = await userModel.getUserByEmail(email);

    if (!user || (user.is_active !== null && user.is_active === 0)) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        data: null,
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        data: null,
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return res.status(500).json({
        success: false,
        message: "Login failed",
        data: null,
      });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    const safeUser = await userModel.getUserById(user.id);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: { token, user: safeUser },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Login failed",
      data: null,
    });
  }
}

module.exports = {
  register,
  login,
};
