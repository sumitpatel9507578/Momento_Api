const jwt = require("jsonwebtoken");

// Verify the Bearer JWT and attach its user data to the request
function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;
  const token =
    authorization && authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;

  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      data: null,
    });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      data: null,
    });
  }
}

module.exports = authMiddleware;
