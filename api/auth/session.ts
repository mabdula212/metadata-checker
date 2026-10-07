import type { IncomingMessage, ServerResponse } from "http";
import { prisma } from "../../lib/db/prisma.js";
import {
  validateRequestSession,
  extractSessionToken,
  hashSessionToken,
  extractDeviceToken,
  generateDeviceToken,
  hashDeviceToken,
  parseDeviceMetadata,
  buildDeviceCookie,
  buildClearSessionCookie,
  loginRequestStatusHandler,
} from "../../lib/auth/index.js";

/**
 * API Handler for Current Session Inspection & Device Login Request Status.
 * Routes:
 * - GET  /api/auth/session
 * - GET  /api/auth/login-request?requestId=... (via Vercel rewrite)
 * - POST /api/auth/login-request (via Vercel rewrite)
 */
export default async function sessionHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  const url = req.url || "/api/auth/session";
  if (
    url.includes("/api/auth/login-request") ||
    url.includes("__route=login-request") ||
    url.includes("requestId=")
  ) {
    return loginRequestStatusHandler(req, res);
  }

  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: "Method not allowed. Use GET." }));
    return;
  }

  try {
    const rawSessionToken = extractSessionToken(req);
    const user = await validateRequestSession(req);

    if (!user) {
      if (rawSessionToken) {
        res.setHeader("Set-Cookie", buildClearSessionCookie());
      }
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          authenticated: false,
          user: null,
          sessionRevoked: Boolean(rawSessionToken),
        })
      );
      return;
    }

    // Ensure the active session is bound to an ACTIVE Device record (auto-migrates pre-upgrade sessions)
    const existingRawDeviceToken = extractDeviceToken(req);
    const rawDeviceToken = existingRawDeviceToken || generateDeviceToken();
    const deviceTokenHash = hashDeviceToken(rawDeviceToken);

    const activeDevice = await prisma.device.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });

    if (!activeDevice) {
      const { deviceName, browser, operatingSystem } = parseDeviceMetadata(
        req.headers["user-agent"]
      );
      const now = new Date();
      const boundDevice = await prisma.device.upsert({
        where: {
          userId_deviceTokenHash: {
            userId: user.id,
            deviceTokenHash,
          },
        },
        update: {
          status: "ACTIVE",
          deviceName,
          browser,
          operatingSystem,
          lastSeenAt: now,
          revokedAt: null,
        },
        create: {
          userId: user.id,
          deviceTokenHash,
          deviceName,
          browser,
          operatingSystem,
          status: "ACTIVE",
          lastSeenAt: now,
        },
      });

      if (rawSessionToken) {
        const sessionTokenHash = hashSessionToken(rawSessionToken);
        const currentSession = await prisma.session.findFirst({
          where: {
            OR: [{ sessionToken: sessionTokenHash }, { sessionToken: rawSessionToken }],
          },
        });
        if (currentSession) {
          await prisma.session.update({
            where: { id: currentSession.id },
            data: { deviceId: boundDevice.id },
          });
          await prisma.session.deleteMany({
            where: { userId: user.id, id: { not: currentSession.id } },
          });
        }
      }
    }

    res.setHeader("Set-Cookie", buildDeviceCookie(rawDeviceToken));

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        authenticated: true,
        deviceToken: rawDeviceToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        },
      })
    );
  } catch (err) {
    console.error("[SESSION_HANDLER_ERROR]", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ authenticated: false, user: null, error: "Internal server error" }));
  }
}
