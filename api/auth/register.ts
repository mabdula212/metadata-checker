import type { IncomingMessage, ServerResponse } from "http";
import { Role, UserStatus } from "@prisma/client";
import { prisma } from "../../lib/db/prisma.js";
import {
  hashPassword,
  validatePasswordStrength,
  checkRateLimit,
  logAuditEvent,
  ensureDefaultAdminExists,
} from "../../lib/auth/index.js";

/**
 * API Handler for User Self-Registration ("Create Account").
 * Method: POST /api/auth/register
 * Body: { "name": "...", "email": "...", "password": "..." }
 */
export default async function registerHandler(
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

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    // 1. Validate fields presence
    if (!email || !password) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: "Email and password are required.",
        })
      );
      return;
    }

    // 2. Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: "Please enter a valid email address.",
        })
      );
      return;
    }

    // 3. Validate password strength
    const strengthCheck = validatePasswordStrength(password);
    if (!strengthCheck.valid) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: strengthCheck.reason || "Password does not meet security requirements.",
        })
      );
      return;
    }

    // 4. Rate limiting: 10 registration attempts per minute per IP
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";
    const rateCheck = checkRateLimit(`register:${clientIp}`, 10, 60 * 1000);
    if (!rateCheck.allowed) {
      res.statusCode = 429;
      res.setHeader("Retry-After", rateCheck.retryAfterSeconds.toString());
      res.end(
        JSON.stringify({
          success: false,
          error: `Too many account creation attempts. Please try again in ${rateCheck.retryAfterSeconds} seconds.`,
        })
      );
      return;
    }

    // Ensure default admin and PENDING enum exist
    await ensureDefaultAdminExists();

    // 5. Check if email is already registered
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.statusCode = 409;
      res.end(
        JSON.stringify({
          success: false,
          error: "Email ini sudah terdaftar. Silakan masuk atau tunggu otorisasi Admin.",
        })
      );
      return;
    }

    // 6. Securely hash password using bcrypt (12 rounds)
    const passwordHash = await hashPassword(password);

    // 7. Create user in PostgreSQL database with PENDING status (requires Admin authorization)
    const user = await prisma.user.create({
      data: {
        email,
        name: name || email.split("@")[0],
        role: Role.USER,
        status: UserStatus.PENDING,
        passwordHash,
        passwordPlain: password,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    // 8. Record audit event for pending registration
    await logAuditEvent({
      userId: user.id,
      action: "USER_REGISTERED_PENDING",
      entityType: "USER",
      entityId: user.id,
      metadata: { email: user.email, name: user.name, role: user.role, status: user.status },
    });

    res.statusCode = 201;
    res.end(
      JSON.stringify({
        success: true,
        pendingApproval: true,
        message:
          "Registrasi berhasil! Akun Anda telah dibuat dan sedang menunggu otorisasi dari Administrator sebelum dapat digunakan untuk login.",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        },
      })
    );
  } catch (err: any) {
    console.error("[REGISTER_ERROR]", err);
    res.statusCode = 500;
    const errMsg = String(err?.message || err || "");
    let userMsg = "An unexpected error occurred while creating your account. Please try again.";

    if (errMsg.includes("DATABASE_URL") || errMsg.includes("Environment variable not found")) {
      userMsg = "Database connection error: DATABASE_URL environment variable is missing on Vercel/server.";
    } else if (errMsg.includes("connect ECONNREFUSED") || errMsg.includes("Can't reach database server")) {
      userMsg = "Cannot reach database server. Please check your DATABASE_URL credentials.";
    } else if (errMsg.includes("did not initialize yet")) {
      userMsg = "Prisma Client is not initialized. Build generation required.";
    }

    res.end(
      JSON.stringify({
        success: false,
        error: userMsg,
      })
    );
  }
}
