/**
 * Authentication and Session Configuration
 */

export const AUTH_COOKIE_NAME = "mc_session";

// Session lifespan: 7 days in seconds
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 604800 seconds

// Password policy constants
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Returns the configured AUTH_SECRET, or a development fallback.
 * The application will not crash if AUTH_SECRET is omitted in development/test,
 * but strictly requires AUTH_SECRET in production.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FATAL: AUTH_SECRET environment variable must be configured in production. Please set AUTH_SECRET in your Vercel Project Settings."
      );
    }
    return "metadata-checker-dev-auth-secret-change-in-production";
  }
  return secret;
}

/**
 * Generates cookie serialization string with HttpOnly, SameSite, and Secure flags.
 */
export function buildSessionCookie(token: string, maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS, forceSecure?: boolean): string {
  const isProd = process.env.NODE_ENV === "production" || forceSecure;
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isProd) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Generates cookie serialization string to clear session.
 */
export function buildClearSessionCookie(forceSecure?: boolean): string {
  const isProd = process.env.NODE_ENV === "production" || forceSecure;
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isProd) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
