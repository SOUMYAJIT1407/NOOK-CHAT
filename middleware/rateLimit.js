/**
 * middleware/rateLimit.js — tiny in-memory rate limiter (no extra packages).
 * Counts requests per client IP in a time window and answers 429 when the limit is exceeded.
 * It lives in this server's memory, which is exactly right for a single instance. If you ever
 * run several instances, swap it for a shared store (e.g. Redis).
 */
export function rateLimit({ windowMs, max, message = "Too many requests. Please try again later.", onLimit }) {
  const hits = new Map(); // key -> { count, resetAt }

  // Forget expired entries now and then so the Map cannot grow forever.
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, Math.min(windowMs, 60_000));
  cleaner.unref(); // never keep the process alive just for this timer

  return function limiter(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      if (onLimit) return onLimit(req, res, message);
      return res.status(429).json({ success: false, message });
    }
    next();
  };
}
