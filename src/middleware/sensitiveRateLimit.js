const attempts = new Map();

module.exports = function sensitiveRateLimit(windowMs = 15 * 60 * 1000, max = 10) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const record = attempts.get(key);
    if (!record || record.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    record.count += 1;
    if (record.count > max) {
      res.set("Retry-After", String(Math.ceil((record.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, message: "Too many attempts. Try again later." });
    }
    return next();
  };
};
