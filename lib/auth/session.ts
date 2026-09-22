import crypto from "crypto";
import type { IncomingMessage } from "http";
import { prisma } from "../db/prisma";
import { AUTH_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "./config";
import type { AuthenticatedUser, SessionInfo } from "./types";

/**
 * Parses cookies from an incoming HTTP request header.
 */
export function parseCookies(req: IncomingMessage): Record<string, string> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return {};

  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((pair) => {
    const [name, ...rest] = pair.split("=");
    if (name) {
      cookies[name.trim()] = decodeURIComponent(rest.join("=").trim());
    }
  });
  return cookies;
}

/**
 * Extracts session token from cookie or Authorization header.
 */
export function extractSessionToken(req: IncomingMessage): string | null {
  // 1. Check Authorization header: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  // 2. Check HttpOnly cookie
  const cookies = parseCookies(req);
  const cookieToken = cookies[AUTH_COOKIE_NAME];
  if (cookieToken && cookieToken.trim().length > 0) {
    return cookieToken.trim();
  }

  return null;
}

/**
 * Generates SHA-256 hash of a raw session token.
 * Only the hash is stored in PostgreSQL. Raw session tokens are NEVER persisted.
 */
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Creates and persists a new server-side session in PostgreSQL.
 * Computes SHA-256 hash of the 256-bit cryptographically secure random token,
 * storing ONLY the hash in the database while returning the raw token for client cookie/bearer use.
 */
export async function createSession(userId: string): Promise<SessionInfo> {
  const rawSessionToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawSessionToken);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  const session = await prisma.session.create({
    data: {
      sessionToken: tokenHash, // Store ONLY the SHA-256 hash
      userId,
      expiresAt,
    },
    include: {
      user: true,
    },
  });

  const user: AuthenticatedUser = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    status: session.user.status,
    createdAt: session.user.createdAt,
    updatedAt: session.user.updatedAt,
  };

  return {
    sessionToken: rawSessionToken, // Hand raw token to caller for secure client-side delivery
    userId: session.userId,
    expiresAt: session.expiresAt,
    user,
  };
}

/**
 * Validates a session token from an incoming HTTP request against the database.
 * The client supplies the raw token, which is hashed with SHA-256 to query PostgreSQL.
 * Returns the AuthenticatedUser if valid and active, or null if invalid, expired, or deactivated.
 */
export async function validateRequestSession(req: IncomingMessage): Promise<AuthenticatedUser | null> {
  const rawToken = extractSessionToken(req);
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length < 16) {
    return null;
  }

  const tokenHash = hashSessionToken(rawToken);

  try {
    // Primary query: look up by token hash (only hash is stored)
    // Also support checking rawToken as a legacy fallback for sessions created before hardening
    const session = await prisma.session.findFirst({
      where: {
        OR: [
          { sessionToken: tokenHash },
          { sessionToken: rawToken },
        ],
      },
      include: { user: true },
    });

    if (!session) {
      return null;
    }

    // Check expiration
    if (session.expiresAt < new Date()) {
      // Lazy delete expired session
      await prisma.session.delete({ where: { id: session.id } }).catch(() => null);
      return null;
    }

    // Check user active status
    if (!session.user || session.user.status === "DEACTIVATED") {
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      status: session.user.status,
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    };
  } catch (err) {
    console.error("[SESSION_VALIDATION_ERROR]", err);
    return null;
  }
}

/**
 * Destroys a session token in the database.
 * Computes hash to delete the corresponding persisted session record.
 */
export async function destroySession(rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashSessionToken(rawToken);
  try {
    await prisma.session.deleteMany({
      where: {
        OR: [
          { sessionToken: tokenHash },
          { sessionToken: rawToken },
        ],
      },
    });
  } catch {
    // ignore if already deleted
  }
}

/**
 * Destroys all active sessions for a user (e.g. on deactivation or password reset).
 */
export async function destroyAllUserSessions(userId: string): Promise<void> {
  try {
    await prisma.session.deleteMany({
      where: { userId },
    });
  } catch {
    // ignore
  }
}
