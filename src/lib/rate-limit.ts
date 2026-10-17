import { NextResponse } from "next/server";

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_ENTRIES = 10_000;

function cleanupExpired(now: number): void {
  if (
    now - lastCleanup < CLEANUP_INTERVAL_MS &&
    rateLimitStore.size < MAX_ENTRIES
  ) {
    return;
  }
  lastCleanup = now;

  for (const [key, bucket] of rateLimitStore.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }

  // If still over MAX_ENTRIES, prune oldest entries
  if (rateLimitStore.size >= MAX_ENTRIES) {
    let toRemove = rateLimitStore.size - Math.floor(MAX_ENTRIES * 0.75);
    for (const key of rateLimitStore.keys()) {
      rateLimitStore.delete(key);
      toRemove--;
      if (toRemove <= 0) break;
    }
  }
}

/**
 * Checks an in-memory sliding/fixed window rate limit for a given key.
 *
 * @param key Unique identifier (e.g. `search:userId` or `ip:127.0.0.1`)
 * @param limit Maximum allowed attempts within the window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  cleanupExpired(now);

  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    const bucket: RateLimitBucket = {
      count: 1,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, bucket);
    return {
      success: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetMs: windowMs,
    };
  }

  if (existing.count >= limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      resetMs: Math.max(0, existing.resetAt - now),
    };
  }

  existing.count += 1;
  return {
    success: true,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetMs: Math.max(0, existing.resetAt - now),
  };
}

/**
 * Generates a standardized 429 Too Many Requests response with standard rate-limit headers.
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(result.resetMs / 1000));
  return NextResponse.json(
    {
      error: "Too many requests. Please slow down and try again later.",
      code: "RATE_LIMITED",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(
          Math.ceil((Date.now() + result.resetMs) / 1000)
        ),
      },
    }
  );
}

/**
 * Extracts client IP address from standard proxy headers or falls back to loopback.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

/**
 * Test helper to clear in-memory rate limit store.
 */
export function resetRateLimitsForTests(): void {
  rateLimitStore.clear();
}
