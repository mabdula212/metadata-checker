import type { IncomingMessage, ServerResponse } from "http";
import { prisma } from "../../lib/db/prisma.js";
import {
  extractDeviceToken,
  hashDeviceToken,
  expireStaleLoginRequests,
  createSession,
  buildSessionCookie,
  buildDeviceCookie,
  logAuditEvent,
} from "../../lib/auth/index.js";

/**
 * API Handler for Device Login Request Polling & Cancellation.
 * - GET  /api/auth/login-request?requestId=...
 * - POST /api/auth/login-request  { requestId, action: "CANCEL" | "CLAIM", deviceToken? }
 */
export default async function loginRequestStatusHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader("Content-Type", "application/json");

  try {
    const urlObj = new URL(req.url || "/api/auth/login-request", "http://localhost");
    let requestId = urlObj.searchParams.get("requestId")?.trim() || "";
    let action = urlObj.searchParams.get("action")?.trim().toUpperCase() || "STATUS";
    let bodyDeviceToken: unknown = urlObj.searchParams.get("deviceToken") || undefined;

    if (req.method === "POST") {
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

      if (typeof body.requestId === "string" && body.requestId.trim()) {
        requestId = body.requestId.trim();
      }
      if (typeof body.action === "string" && body.action.trim()) {
        action = body.action.trim().toUpperCase();
      }
      if (body.deviceToken) {
        bodyDeviceToken = body.deviceToken;
      }
    } else if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ success: false, error: "Method not allowed. Use GET or POST." }));
      return;
    }

    if (!requestId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Missing required 'requestId'." }));
      return;
    }

    const rawDeviceToken = extractDeviceToken(req, bodyDeviceToken);
    if (!rawDeviceToken) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          success: false,
          error: "Missing device token. Please initiate login from this browser again.",
        })
      );
      return;
    }

    const deviceTokenHash = hashDeviceToken(rawDeviceToken);

    await expireStaleLoginRequests();

    const loginRequest = await prisma.loginRequest.findUnique({
      where: { id: requestId },
      include: {
        user: true,
        device: true,
      },
    });

    if (!loginRequest) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: "Login request not found." }));
      return;
    }

    // Security check: Ensure the caller owns the device that created this LoginRequest
    if (loginRequest.device.deviceTokenHash !== deviceTokenHash) {
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          success: false,
          error: "Device identity mismatch for this login request.",
        })
      );
      return;
    }

    // Handle user cancellation of pending request
    if (req.method === "POST" && action === "CANCEL") {
      if (loginRequest.status === "PENDING") {
        await prisma.loginRequest.update({
          where: { id: loginRequest.id },
          data: { status: "CANCELLED", reviewedAt: new Date() },
        });
      }
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          status: "CANCELLED",
          message: "Permintaan login perangkat baru telah dibatalkan.",
        })
      );
      return;
    }

    // If APPROVED and device is ACTIVE and user is ACTIVE -> issue session for this new device!
    if (
      loginRequest.status === "APPROVED" &&
      loginRequest.device.status === "ACTIVE" &&
      loginRequest.user.status === "ACTIVE"
    ) {
      // Ensure strictly one active session for the user
      await prisma.session.deleteMany({
        where: { userId: loginRequest.userId },
      });

      const session = await createSession(loginRequest.userId, loginRequest.deviceId);

      res.setHeader("Set-Cookie", [
        buildSessionCookie(session.sessionToken),
        buildDeviceCookie(rawDeviceToken),
      ]);

      await logAuditEvent({
        userId: loginRequest.userId,
        action: "LOGIN",
        entityType: "USER",
        entityId: loginRequest.userId,
        metadata: {
          email: loginRequest.user.email,
          deviceId: loginRequest.deviceId,
          deviceName: loginRequest.device.deviceName,
          loginRequestId: loginRequest.id,
          viaDeviceApproval: true,
        },
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          status: "APPROVED",
          authenticated: true,
          user: {
            id: loginRequest.user.id,
            email: loginRequest.user.email,
            name: loginRequest.user.name,
            role: loginRequest.user.role,
            status: loginRequest.user.status,
          },
          token: session.sessionToken,
          deviceToken: rawDeviceToken,
        })
      );
      return;
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        status: loginRequest.status,
        authenticated: false,
        rejectionReason: loginRequest.rejectionReason || null,
        expiresAt: loginRequest.expiresAt.toISOString(),
        requestedAt: loginRequest.requestedAt.toISOString(),
        reviewedAt: loginRequest.reviewedAt ? loginRequest.reviewedAt.toISOString() : null,
        device: {
          id: loginRequest.device.id,
          deviceName: loginRequest.device.deviceName,
          browser: loginRequest.device.browser,
          operatingSystem: loginRequest.device.operatingSystem,
          status: loginRequest.device.status,
        },
      })
    );
  } catch (err) {
    console.error("[LOGIN_REQUEST_STATUS_ERROR]", err);
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: "Failed to check device login request status.",
      })
    );
  }
}
