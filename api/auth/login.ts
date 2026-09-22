import type { IncomingMessage, ServerResponse } from "http";
import { prisma } from "../../lib/db/prisma";
import {
  verifyPassword,
  createSession,
  buildSessionCookie,
  checkRateLimit,
  resetRateLimit,
  logAuditEvent,
} from "../../lib/auth";

/**
 * API Handler for User Login.
 * Method: POST /api/auth/login
 * Body: { "email": "...", "password": "...", "rememberMe": boolean }
 */
export default async function loginHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST." }));
    return;
  }

  try {
    // Read request body (compatible with Vercel pre-parsed body and raw Node stream)
    let body: Record<string, unknown> = {};
    const reqAny = req as any;

    if (reqAny.body && typeof reqAny.body === "object") {
      body = reqAny.body;
    } else if (typeof reqAny.body === "string" && reqAny.body.trim()) {
      try {
        body = JSON.parse(reqAny.body);
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: "Invalid JSON request body." }));
        return;
      }
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyText = Buffer.concat(chunks).toString("utf-8");
      if (bodyText.trim()) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: "Invalid JSON request body." }));
          return;
        }
      }
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const rememberMe = Boolean(body.rememberMe);

    // Validate presence
    if (!email || !password) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Email and password are required." }));
      return;
    }

    // Rate limiting: defense against brute force and credential stuffing
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";

    // 1. IP-level safeguard (mitigates multi-email credential spraying)
    const ipRateCheck = checkRateLimit(`ip:${clientIp}`, 25, 60 * 1000);
    if (!ipRateCheck.allowed) {
      res.statusCode = 429;
      res.setHeader("Retry-After", ipRateCheck.retryAfterSeconds.toString());
      res.end(
        JSON.stringify({
          success: false,
          error: `Too many login requests from your IP. Please try again in ${ipRateCheck.retryAfterSeconds} seconds.`,
        })
      );
      return;
    }

    // 2. Account-level safeguard (5 attempts per 60 seconds per IP+email pair)
    const rateKey = `${clientIp}:${email}`;
    const rateCheck = checkRateLimit(rateKey, 5, 60 * 1000);

    if (!rateCheck.allowed) {
      res.statusCode = 429;
      res.setHeader("Retry-After", rateCheck.retryAfterSeconds.toString());
      res.end(
        JSON.stringify({
          success: false,
          error: `Too many login attempts. Please try again in ${rateCheck.retryAfterSeconds} seconds.`,
        })
      );
      return;
    }

    // Look up user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Dummy bcrypt hash for constant-time comparison when email does not exist (Timing Attack Defense)
    const DUMMY_BCRYPT_HASH = "$2a$12$e0NZh9p6iT.9k4yq5e5MneXv3bXh2w9N9qQy0L5a9i6o4m6g.D0Ky";

    // Check credentials (generic response and timing equalization to prevent enumeration)
    if (!user || !user.passwordHash) {
      await verifyPassword(password, DUMMY_BCRYPT_HASH).catch(() => false);

      await logAuditEvent({
        action: "LOGIN_FAILED",
        entityType: "USER",
        metadata: { email, reason: "INVALID_CREDENTIALS" },
      });

      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, error: "Invalid email or password." }));
      return;
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      await logAuditEvent({
        userId: user.id,
        action: "LOGIN_FAILED",
        entityType: "USER",
        entityId: user.id,
        metadata: { email, reason: "INVALID_CREDENTIALS" },
      });

      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, error: "Invalid email or password." }));
      return;
    }

    // Check user account status
    if (user.status === "DEACTIVATED") {
      await logAuditEvent({
        userId: user.id,
        action: "LOGIN_FAILED",
        entityType: "USER",
        entityId: user.id,
        metadata: { email, reason: "ACCOUNT_DEACTIVATED" },
      });

      res.statusCode = 403;
      res.end(
        JSON.stringify({
          success: false,
          error: "Your account has been deactivated. Please contact an administrator.",
        })
      );
      return;
    }

    // Reset rate limit on success
    resetRateLimit(rateKey);

    // Create persistent server session
    const session = await createSession(user.id);

    // Set HttpOnly session cookie
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 : undefined;
    res.setHeader("Set-Cookie", buildSessionCookie(session.sessionToken, maxAge));

    // Audit log successful login
    await logAuditEvent({
      userId: user.id,
      action: "LOGIN",
      entityType: "USER",
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        },
        token: session.sessionToken,
      })
    );
  } catch (err: any) {
    console.error("[LOGIN_ERROR]", err);
    res.statusCode = 500;
    const errMsg = String(err?.message || err || "");
    let userMsg = "An unexpected error occurred during login.";

    if (errMsg.includes("DATABASE_URL") || errMsg.includes("Environment variable not found")) {
      userMsg = "Database connection error: DATABASE_URL environment variable is missing on Vercel/server.";
    } else if (errMsg.includes("connect ECONNREFUSED") || errMsg.includes("Can't reach database server")) {
      userMsg = "Cannot reach database server. Please check your DATABASE_URL credentials.";
    } else if (errMsg.includes("did not initialize yet")) {
      userMsg = "Prisma Client is not initialized. Build generation required.";
    }

    res.end(JSON.stringify({ success: false, error: userMsg }));
  }
}
