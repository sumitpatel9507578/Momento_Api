const jwt = require("jsonwebtoken");

// Fixed admin credentials — no MySQL connection
const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "admin1234";

async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("JWT_SECRET is missing.");
      return res.status(500).json({
        success: false,
        message: "Server authentication is not configured",
      });
    }

    // Only the configured credentials are accepted
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase() ||
      password !== ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    const admin = {
      id: "momentz-static-admin",
      username: "Momentz Admin",
      email: ADMIN_EMAIL,
      role: "admin",
    };

    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: "admin",
      },
      jwtSecret,
      { expiresIn: "90d" },
    );

    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      data: {
        token,
        user: admin,
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

module.exports = { login };
