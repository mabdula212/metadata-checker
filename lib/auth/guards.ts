import type { IncomingMessage, ServerResponse } from "http";
import { Role } from "@prisma/client";
import { validateRequestSession } from "./session";
import type { AuthenticatedUser } from "./types";
import { prisma } from "../db/prisma";

export interface GuardAuthResult {
  user: AuthenticatedUser;
}

/**
 * Verifies that state-changing requests authenticated by ambient cookies
 * originate from the same site/host to prevent Cross-Site Request Forgery (CSRF).
 * Requests using Authorization: Bearer tokens are exempted since browsers do not attach
 * custom headers automatically on cross-site form submissions.
 */
export function verifyCsrf(req: IncomingMessage): boolean {
  const method = req.method?.toUpperCase();
  // Safe HTTP methods do not mutate state
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }

  // If request uses Authorization Bearer, CSRF is not applicable
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return true;
  }

  // Check Sec-Fetch-Site if provided by modern browser
  const secFetchSite = req.headers["sec-fetch-site"];
  if (secFetchSite && secFetchSite === "cross-site") {
    return false;
  }

  const origin = req.headers.origin;
  const host = req.headers.host;

  if (origin && typeof origin === "string") {
    try {
      const parsedOrigin = new URL(origin);
      if (host && parsedOrigin.host !== host) {
        const isLocalOrigin = parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1";
        const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
        if (!(isLocalOrigin && isLocalHost)) {
          return false;
        }
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Sanitizes server-side error messages before sending to client.
 * Strips Prisma internals, SQL connection strings, filesystem paths, and secrets.
 */
export function sanitizeClientErrorMessage(err: unknown, fallbackMessage = "An unexpected error occurred."): string {
  if (!err) return fallbackMessage;
  const msg = err instanceof Error ? err.message : String(err);

  // If Prisma error or connection string detected
  if (
    msg.includes("prisma") ||
    msg.includes("PrismaClient") ||
    msg.includes("DATABASE_URL") ||
    msg.includes("postgresql://") ||
    msg.includes("postgres://") ||
    msg.includes("invocation") ||
    msg.includes("connector")
  ) {
    return "A database operation error occurred. Details have been logged securely.";
  }

  // Strip file paths, connection strings, tokens
  const sanitized = msg
    .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
    .replace(/postgres:\/\/[^@]+@/gi, "postgres://***:***@")
    .replace(/(?:\/[a-zA-Z0-9_.\-]+)+\/[a-zA-Z0-9_.\-]+/g, "[path]")
    .slice(0, 200);

  return sanitized || fallbackMessage;
}

/**
 * Sends a standardized JSON error response.
 */
export function sendJsonError(
  res: ServerResponse,
  statusCode: number,
  errorMessage: string
): void {
  if (!res.headersSent) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: errorMessage,
      })
    );
  }
}

/**
 * Ensures the incoming request is authenticated with an active session.
 * Enforces CSRF verification on state-changing cookie requests.
 * Responds with 401 Unauthorized if missing, invalid, expired, or deactivated.
 */
export async function requireAuth(
  req: IncomingMessage,
  res: ServerResponse
): Promise<AuthenticatedUser | null> {
  // CSRF Defense-in-depth on state-changing methods
  if (!verifyCsrf(req)) {
    sendJsonError(res, 403, "Cross-Site Request Forgery (CSRF) verification failed.");
    return null;
  }

  const user = await validateRequestSession(req);

  if (!user) {
    sendJsonError(res, 401, "Authentication required. Please sign in.");
    return null;
  }

  if (user.status === "DEACTIVATED") {
    sendJsonError(res, 403, "Your account has been deactivated. Please contact an administrator.");
    return null;
  }

  return user;
}

/**
 * Ensures the user has one of the specified roles (e.g. ADMIN).
 * Responds with 401 if unauthenticated or 403 if forbidden.
 */
export async function requireRole(
  req: IncomingMessage,
  res: ServerResponse,
  allowedRoles: Role[]
): Promise<AuthenticatedUser | null> {
  const user = await requireAuth(req, res);
  if (!user) return null;

  if (!allowedRoles.includes(user.role)) {
    sendJsonError(res, 403, "Access denied. Insufficient administrative privileges.");
    return null;
  }

  return user;
}

/**
 * Ensures that the document exists and belongs to the authenticated user (or user is ADMIN).
 * Prevents Insecure Direct Object References (IDOR).
 */
export async function requireDocumentOwner(
  req: IncomingMessage,
  res: ServerResponse,
  documentId: string
) {
  const user = await requireAuth(req, res);
  if (!user) return null;

  if (!documentId || typeof documentId !== "string") {
    sendJsonError(res, 400, "Missing or invalid document ID.");
    return null;
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      metadata: true,
      statement: true,
    },
  });

  if (!document) {
    sendJsonError(res, 404, "Document not found.");
    return null;
  }

  // If user is not an ADMIN and not the owner of the document
  if (user.role !== Role.ADMIN && document.userId !== user.id) {
    sendJsonError(res, 403, "Access denied. You do not own this document.");
    return null;
  }

  return { user, document };
}

/**
 * Ensures that the export exists and belongs to the authenticated user (or user is ADMIN).
 * Prevents Insecure Direct Object References (IDOR) on Excel downloads.
 */
export async function requireExportOwner(
  req: IncomingMessage,
  res: ServerResponse,
  exportId: string
) {
  const user = await requireAuth(req, res);
  if (!user) return null;

  if (!exportId || typeof exportId !== "string") {
    sendJsonError(res, 400, "Missing or invalid export ID.");
    return null;
  }

  const exportRecord = await prisma.export.findUnique({
    where: { id: exportId },
    include: {
      document: true,
    },
  });

  if (!exportRecord) {
    sendJsonError(res, 404, "Export record not found.");
    return null;
  }

  if (user.role !== Role.ADMIN && exportRecord.userId !== user.id) {
    sendJsonError(res, 403, "Access denied. You do not own this export file.");
    return null;
  }

  return { user, exportRecord };
}
