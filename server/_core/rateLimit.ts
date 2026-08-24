import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  maxTrackedClients?: number;
};

type ClientWindow = {
  count: number;
  resetAt: number;
};

/**
 * A small, dependency-free limiter for a single staging process. Deployments
 * with multiple API replicas should replace its in-memory store with Redis or
 * another shared atomic counter.
 */
export function createRateLimit(options: RateLimitOptions) {
  const clients = new Map<string, ClientWindow>();
  const maxTrackedClients = options.maxTrackedClients ?? 10_000;

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let window = clients.get(key);

    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + options.windowMs };
      clients.set(key, window);
    }

    window.count += 1;
    const remaining = Math.max(0, options.max - window.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(window.resetAt / 1000)));

    if (window.count > options.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((window.resetAt - now) / 1000)
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res
        .status(429)
        .json({ error: "Too many requests. Please try again later." });
      return;
    }

    if (clients.size > maxTrackedClients) {
      clients.forEach((value, clientKey) => {
        if (value.resetAt <= now || clients.size > maxTrackedClients) {
          clients.delete(clientKey);
        }
      });
    }

    next();
  };
}
