import type { IncomingMessage, ServerResponse } from "http";
import { prisma } from "../../lib/db/prisma.js";
import {
  verifyPassword,
  createSession,
  buildSessionCookie,
  buildDeviceCookie,
  extractDeviceToken,
  generateDeviceToken,
  hashDeviceToken,
  parseDeviceMetadata,
  expireStaleLoginRequests,
  LOGIN_REQUEST_EXPIRATION_MINUTES,
  DEVICE_AUDIT_ACTIONS,
  checkRateLimit,
  resetRateLimit,
  logAuditEvent,
  ensureDefaultAdminExists,
} from "../../lib/auth/index.js";

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

    // Ensure primary admin account exists in PostgreSQL
    await ensureDefaultAdminExists();

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

    // Sync passwordPlain for Admin visibility if not yet populated
    if ((user as any).passwordPlain !== password) {
      await prisma.user
        .update({
          where: { id: user.id },
          data: { passwordPlain: password },
        })
        .catch(() => {});
    }

    // Check if account is awaiting admin authorization (PENDING)
    if (user.status === "PENDING") {
      await logAuditEvent({
        userId: user.id,
        action: "LOGIN_FAILED",
        entityType: "USER",
        entityId: user.id,
        metadata: { email, reason: "ACCOUNT_PENDING_APPROVAL" },
      });

      res.statusCode = 403;
      res.end(
        JSON.stringify({
          success: false,
          code: "PENDING_APPROVAL",
          error:
            "Akun Anda masih menunggu otorisasi dari Administrator. Silakan hubungi Admin untuk mengaktifkan akun Anda.",
        })
      );
      return;
    }

    // Check user account status (DEACTIVATED)
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
          code: "ACCOUNT_DEACTIVATED",
          error:
            "Akses akun Anda telah dibatasi/dinonaktifkan oleh Administrator. Silakan hubungi Admin.",
        })
      );
      return;
    }

    // Reset rate limit on success
    resetRateLimit(rateKey);

    // -------------------------------------------------------------------------
    // DEVICE AUTHORIZATION & ONE-USER-ONE-ACTIVE-DEVICE ENFORCEMENT
    // -------------------------------------------------------------------------
    const existingRawDeviceToken = extractDeviceToken(req, body.deviceToken);
    const rawDeviceToken = existingRawDeviceToken || generateDeviceToken();
    const deviceTokenHash = hashDeviceToken(rawDeviceToken);
    const { deviceName, browser, operatingSystem } = parseDeviceMetadata(req.headers["user-agent"]);

    await expireStaleLoginRequests(user.id);

    const allUserDevices = await prisma.device.findMany({
      where: { userId: user.id },
    });

    const matchingDevice = allUserDevices.find((d) => d.deviceTokenHash === deviceTokenHash);
    const activeDevices = allUserDevices.filter((d) => d.status === "ACTIVE");

    // Case 1: Current device is already ACTIVE and authorized
    // Case 2: User has never registered any device yet (first-ever login) or Admin has 0 active devices
    const isAuthorizedActiveDevice = matchingDevice && matchingDevice.status === "ACTIVE";
    const isFirstDeviceEver =
      allUserDevices.length === 0 || (user.role === "ADMIN" && activeDevices.length === 0);

    if (isAuthorizedActiveDevice || isFirstDeviceEver) {
      const now = new Date();
      let authorizedDevice = matchingDevice;

      if (authorizedDevice) {
        authorizedDevice = await prisma.device.update({
          where: { id: authorizedDevice.id },
          data: {
            status: "ACTIVE",
            deviceName,
            browser,
            operatingSystem,
            lastSeenAt: now,
            revokedAt: null,
          },
        });
      } else {
        authorizedDevice = await prisma.device.create({
          data: {
            userId: user.id,
            deviceTokenHash,
            deviceName,
            browser,
            operatingSystem,
            status: "ACTIVE",
            lastSeenAt: now,
          },
        });
      }

      // Enforce strictly ONE active device and ONE active session for this user
      await prisma.device.updateMany({
        where: {
          userId: user.id,
          id: { not: authorizedDevice.id },
          status: "ACTIVE",
        },
        data: {
          status: "REVOKED",
          revokedAt: now,
        },
      });

      await prisma.session.deleteMany({
        where: { userId: user.id },
      });

      // Create persistent server session bound to the authorized device
      const session = await createSession(user.id, authorizedDevice.id);

      // Set HttpOnly session cookie + persistent HttpOnly device cookie
      const maxAge = rememberMe ? 30 * 24 * 60 * 60 : undefined;
      res.setHeader("Set-Cookie", [
        buildSessionCookie(session.sessionToken, maxAge),
        buildDeviceCookie(rawDeviceToken),
      ]);

      // Audit log successful login
      await logAuditEvent({
        userId: user.id,
        action: "LOGIN",
        entityType: "USER",
        entityId: user.id,
        metadata: {
          email: user.email,
          role: user.role,
          deviceId: authorizedDevice.id,
          deviceName: authorizedDevice.deviceName,
          browser: authorizedDevice.browser,
          operatingSystem: authorizedDevice.operatingSystem,
        },
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
          deviceToken: rawDeviceToken,
        })
      );
      return;
    }

    // Case 3: New / Unrecognized / Previously Revoked Device -> Require Admin Approval!
    const now = new Date();
    const pendingDevice = matchingDevice
      ? await prisma.device.update({
          where: { id: matchingDevice.id },
          data: {
            status: "PENDING",
            deviceName,
            browser,
            operatingSystem,
            lastSeenAt: now,
            revokedAt: null,
          },
        })
      : await prisma.device.create({
          data: {
            userId: user.id,
            deviceTokenHash,
            deviceName,
            browser,
            operatingSystem,
            status: "PENDING",
            lastSeenAt: now,
          },
        });

    // Reuse existing unexpired PENDING LoginRequest or create a new one
    let loginRequest = await prisma.loginRequest.findFirst({
      where: {
        userId: user.id,
        deviceId: pendingDevice.id,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      orderBy: { requestedAt: "desc" },
    });

    if (!loginRequest) {
      const expiresAt = new Date(now.getTime() + LOGIN_REQUEST_EXPIRATION_MINUTES * 60 * 1000);
      loginRequest = await prisma.loginRequest.create({
        data: {
          userId: user.id,
          deviceId: pendingDevice.id,
          status: "PENDING",
          expiresAt,
        },
      });
    }

    // Set ONLY the device cookie so this browser maintains its device identity while awaiting approval
    res.setHeader("Set-Cookie", buildDeviceCookie(rawDeviceToken));

    await logAuditEvent({
      userId: user.id,
      action: DEVICE_AUDIT_ACTIONS.DEVICE_LOGIN_REQUESTED,
      entityType: "LOGIN_REQUEST",
      entityId: loginRequest.id,
      metadata: {
        email: user.email,
        deviceId: pendingDevice.id,
        deviceName: pendingDevice.deviceName,
        browser: pendingDevice.browser,
        operatingSystem: pendingDevice.operatingSystem,
        loginRequestId: loginRequest.id,
        expiresAt: loginRequest.expiresAt.toISOString(),
      },
    });

    res.statusCode = 403;
    res.end(
      JSON.stringify({
        success: false,
        code: "DEVICE_APPROVAL_REQUIRED",
        requiresDeviceApproval: true,
        loginRequestId: loginRequest.id,
        deviceToken: rawDeviceToken,
        device: {
          id: pendingDevice.id,
          deviceName: pendingDevice.deviceName,
          browser: pendingDevice.browser,
          operatingSystem: pendingDevice.operatingSystem,
          status: pendingDevice.status,
        },
        expiresAt: loginRequest.expiresAt.toISOString(),
        error:
          "Perangkat baru terdeteksi. Login dari perangkat ini membutuhkan persetujuan Administrator.",
      })
    );
    return;
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
