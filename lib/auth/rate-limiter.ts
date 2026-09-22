interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleEntries(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of rateLimitStore.entries()) {
    const validTimestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
    if (validTimestamps.length === 0) {
      rateLimitStore.delete(key);
    } else {
      entry.timestamps = validTimestamps;
    }
  }
}

/**
 * Checks and records an attempt for the given identifier (IP or email).
 * Returns { allowed: boolean, remainingAttempts: number, retryAfterSeconds: number }.
 */
export function checkRateLimit(
  identifier: string,
  maxAttempts: number = 5,
  windowMs: number = 60 * 1000
): { allowed: boolean; remainingAttempts: number; retryAfterSeconds: number } {
  cleanupStaleEntries(windowMs);

  const now = Date.now();
  const entry = rateLimitStore.get(identifier) || { timestamps: [] };

  // Retain only timestamps within the window
  const validTimestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  if (validTimestamps.length >= maxAttempts) {
    const oldest = validTimestamps[0];
    const retryAfterMs = oldest + windowMs - now;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds,
    };
  }

  validTimestamps.push(now);
  rateLimitStore.set(identifier, { timestamps: validTimestamps });

  return {
    allowed: true,
    remainingAttempts: maxAttempts - validTimestamps.length,
    retryAfterSeconds: 0,
  };
}

/**
 * Resets rate limit for an identifier (e.g. on successful login).
 */
export function resetRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier);
}
