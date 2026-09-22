const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;
  const token =
    authorization && authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;

  console.log(`[AUTH] Incoming request: ${req.method} ${req.url}`);
  console.log(
    `[AUTH] Authorization Header: ${authorization ? "Present" : "Missing"}`,
  );
  if (token) {
    console.log(`[AUTH] Token prefix: ${token.substring(0, 10)}...`);
  }

  if (!token) {
    console.log("[AUTH] Verification failed: No token provided");
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      data: null,
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error("[AUTH] Error: JWT_SECRET is not defined in .env");
    return res.status(500).json({
      success: false,
      message: "Server configuration error",
      data: null,
    });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    console.log(
      `[AUTH] Verification success: User ${req.user.username} (ID: ${req.user.id})`,
    );
    return next();
  } catch (error) {
    console.log(`[AUTH] Verification failed: ${error.message}`);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      data: null,
    });
  }
}

module.exports = authMiddleware;
