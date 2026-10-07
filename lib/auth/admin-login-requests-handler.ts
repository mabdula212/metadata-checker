import type { IncomingMessage, ServerResponse } from "http";
import { Role } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import {
  requireRole,
  expireStaleLoginRequests,
  logAuditEvent,
  DEVICE_AUDIT_ACTIONS,
} from "./index.js";

/**
 * Admin Device Login Requests & Device Authorization Management Handler.
 * Endpoints:
 * - GET   /api/admin/login-requests
 * - POST  /api/admin/login-requests
 * - PATCH /api/admin/login-requests
 */
export default async function adminLoginRequestsHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader("Content-Type", "application/json");

  const adminUser = await requireRole(req, res, [Role.ADMIN]);
  if (!adminUser) return;

  await expireStaleLoginRequests();

  // -------------------------------------------------------------
  // GET: List all login requests and active user devices
  // -------------------------------------------------------------
  if (req.method === "GET") {
    try {
      const [loginRequests, activeDevices] = await Promise.all([
        prisma.loginRequest.findMany({
          orderBy: [{ requestedAt: "desc" }],
          take: 100,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                status: true,
              },
            },
            device: {
              select: {
                id: true,
                deviceName: true,
                browser: true,
                operatingSystem: true,
                status: true,
                lastSeenAt: true,
                createdAt: true,
                revokedAt: true,
              },
            },
            reviewer: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        }),
        prisma.device.findMany({
          where: { status: "ACTIVE" },
          select: {
            id: true,
            userId: true,
            deviceName: true,
            browser: true,
            operatingSystem: true,
            status: true,
            lastSeenAt: true,
            createdAt: true,
          },
        }),
      ]);

      const activeDeviceByUser = new Map<string, (typeof activeDevices)[number]>();
      for (const dev of activeDevices) {
        activeDeviceByUser.set(dev.userId, dev);
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          loginRequests: loginRequests.map((lr) => {
            const currentActive = activeDeviceByUser.get(lr.userId) || null;
            return {
              id: lr.id,
              userId: lr.userId,
              deviceId: lr.deviceId,
              status: lr.status,
              requestedAt: lr.requestedAt.toISOString(),
              reviewedAt: lr.reviewedAt ? lr.reviewedAt.toISOString() : null,
              reviewedBy: lr.reviewedBy,
              rejectionReason: lr.rejectionReason,
              expiresAt: lr.expiresAt.toISOString(),
              user: lr.user,
              device: {
                ...lr.device,
                lastSeenAt: lr.device.lastSeenAt.toISOString(),
                createdAt: lr.device.createdAt.toISOString(),
                revokedAt: lr.device.revokedAt ? lr.device.revokedAt.toISOString() : null,
              },
              currentActiveDevice: currentActive
                ? {
                    ...currentActive,
                    lastSeenAt: currentActive.lastSeenAt.toISOString(),
                    createdAt: currentActive.createdAt.toISOString(),
                  }
                : null,
              reviewer: lr.reviewer,
            };
          }),
        })
      );
      return;
    } catch (err) {
      console.error("[ADMIN_LOGIN_REQUESTS_GET_ERROR]", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: "Failed to load device login requests." }));
      return;
    }
  }

  // -------------------------------------------------------------
  // POST / PATCH: Approve, Reject, or Revoke Device
  // -------------------------------------------------------------
  if (req.method === "POST" || req.method === "PATCH") {
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

    const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const rejectionReason =
      typeof body.rejectionReason === "string" && body.rejectionReason.trim()
        ? body.rejectionReason.trim()
        : null;

    // -----------------------------------------------------------
    // ACTION 1: APPROVE LOGIN REQUEST
    // -----------------------------------------------------------
    if (action === "APPROVE") {
      if (!requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: "Missing required 'requestId'." }));
        return;
      }

      try {
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

        if (loginRequest.status !== "PENDING") {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              success: false,
              error: `Login request cannot be approved because its status is ${loginRequest.status}.`,
            })
          );
          return;
        }

        const now = new Date();
        if (loginRequest.expiresAt < now) {
          await prisma.loginRequest.update({
            where: { id: loginRequest.id },
            data: { status: "EXPIRED" },
          });
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              success: false,
              error: "Permintaan login perangkat ini telah kedaluwarsa (expired).",
            })
          );
          return;
        }

        // Atomic transaction:
        // 1. Revoke all previous devices for this user
        // 2. Delete all existing active sessions for this user (revoking old device session)
        // 3. Activate the newly approved device
        // 4. Mark LoginRequest as APPROVED
        // 5. Cancel any other pending LoginRequests for this user
        await prisma.$transaction(async (tx) => {
          await tx.device.updateMany({
            where: {
              userId: loginRequest.userId,
              id: { not: loginRequest.deviceId },
              status: { not: "REVOKED" },
            },
            data: {
              status: "REVOKED",
              revokedAt: now,
            },
          });

          await tx.session.deleteMany({
            where: { userId: loginRequest.userId },
          });

          await tx.device.update({
            where: { id: loginRequest.deviceId },
            data: {
              status: "ACTIVE",
              lastSeenAt: now,
              revokedAt: null,
            },
          });

          await tx.loginRequest.update({
            where: { id: loginRequest.id },
            data: {
              status: "APPROVED",
              reviewedAt: now,
              reviewedBy: adminUser.id,
            },
          });

          await tx.loginRequest.updateMany({
            where: {
              userId: loginRequest.userId,
              id: { not: loginRequest.id },
              status: "PENDING",
            },
            data: {
              status: "CANCELLED",
              reviewedAt: now,
              reviewedBy: adminUser.id,
            },
          });
        });

        await logAuditEvent({
          userId: adminUser.id,
          action: DEVICE_AUDIT_ACTIONS.SESSION_REVOKED,
          entityType: "USER",
          entityId: loginRequest.userId,
          metadata: {
            targetEmail: loginRequest.user.email,
            reason: "NEW_DEVICE_APPROVED_OLD_SESSION_REVOKED",
            newDeviceId: loginRequest.deviceId,
          },
        });

        await logAuditEvent({
          userId: adminUser.id,
          action: DEVICE_AUDIT_ACTIONS.DEVICE_LOGIN_APPROVED,
          entityType: "LOGIN_REQUEST",
          entityId: loginRequest.id,
          metadata: {
            targetUserId: loginRequest.userId,
            targetEmail: loginRequest.user.email,
            deviceId: loginRequest.deviceId,
            deviceName: loginRequest.device.deviceName,
            browser: loginRequest.device.browser,
            operatingSystem: loginRequest.device.operatingSystem,
          },
        });

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: true,
            message: `Perangkat baru (${loginRequest.device.deviceName}) untuk ${loginRequest.user.email} telah disetujui. Sesi perangkat lama telah dicabut.`,
          })
        );
        return;
      } catch (err) {
        console.error("[ADMIN_LOGIN_REQUEST_APPROVE_ERROR]", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, error: "Failed to approve device login request." }));
        return;
      }
    }

    // -----------------------------------------------------------
    // ACTION 2: REJECT LOGIN REQUEST
    // -----------------------------------------------------------
    if (action === "REJECT") {
      if (!requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: "Missing required 'requestId'." }));
        return;
      }

      try {
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

        if (loginRequest.status !== "PENDING") {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              success: false,
              error: `Login request cannot be rejected because its status is ${loginRequest.status}.`,
            })
          );
          return;
        }

        const now = new Date();
        const reason =
          rejectionReason || "Permintaan login dari perangkat baru ditolak oleh Administrator.";

        // Atomic transaction:
        // 1. Mark LoginRequest as REJECTED
        // 2. Mark the requesting Device as REVOKED
        // 3. Do NOT touch existing ACTIVE device or sessions of the user!
        await prisma.$transaction(async (tx) => {
          await tx.loginRequest.update({
            where: { id: loginRequest.id },
            data: {
              status: "REJECTED",
              reviewedAt: now,
              reviewedBy: adminUser.id,
              rejectionReason: reason,
            },
          });

          await tx.device.update({
            where: { id: loginRequest.deviceId },
            data: {
              status: "REVOKED",
              revokedAt: now,
            },
          });

          await tx.session.deleteMany({
            where: { deviceId: loginRequest.deviceId },
          });
        });

        await logAuditEvent({
          userId: adminUser.id,
          action: DEVICE_AUDIT_ACTIONS.DEVICE_LOGIN_REJECTED,
          entityType: "LOGIN_REQUEST",
          entityId: loginRequest.id,
          metadata: {
            targetUserId: loginRequest.userId,
            targetEmail: loginRequest.user.email,
            deviceId: loginRequest.deviceId,
            deviceName: loginRequest.device.deviceName,
            browser: loginRequest.device.browser,
            operatingSystem: loginRequest.device.operatingSystem,
            rejectionReason: reason,
          },
        });

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: true,
            message: `Permintaan login perangkat baru (${loginRequest.device.deviceName}) untuk ${loginRequest.user.email} telah ditolak. Perangkat lama tetap aktif.`,
          })
        );
        return;
      } catch (err) {
        console.error("[ADMIN_LOGIN_REQUEST_REJECT_ERROR]", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, error: "Failed to reject device login request." }));
        return;
      }
    }

    // -----------------------------------------------------------
    // ACTION 3: REVOKE ACTIVE DEVICE
    // -----------------------------------------------------------
    if (action === "REVOKE_DEVICE") {
      if (!deviceId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: "Missing required 'deviceId'." }));
        return;
      }

      try {
        const device = await prisma.device.findUnique({
          where: { id: deviceId },
          include: { user: true },
        });

        if (!device) {
          res.statusCode = 404;
          res.end(JSON.stringify({ success: false, error: "Device not found." }));
          return;
        }

        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.device.update({
            where: { id: device.id },
            data: {
              status: "REVOKED",
              revokedAt: now,
            },
          });

          await tx.session.deleteMany({
            where: {
              OR: [{ deviceId: device.id }, { userId: device.userId }],
            },
          });

          await tx.loginRequest.updateMany({
            where: {
              deviceId: device.id,
              status: "PENDING",
            },
            data: {
              status: "CANCELLED",
              reviewedAt: now,
              reviewedBy: adminUser.id,
            },
          });
        });

        await logAuditEvent({
          userId: adminUser.id,
          action: DEVICE_AUDIT_ACTIONS.DEVICE_REVOKED,
          entityType: "DEVICE",
          entityId: device.id,
          metadata: {
            targetUserId: device.userId,
            targetEmail: device.user.email,
            deviceName: device.deviceName,
            browser: device.browser,
            operatingSystem: device.operatingSystem,
          },
        });

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: true,
            message: `Perangkat ${device.deviceName} milik ${device.user.email} telah dicabut (revoked) dan sesinya dihentikan.`,
          })
        );
        return;
      } catch (err) {
        console.error("[ADMIN_DEVICE_REVOKE_ERROR]", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, error: "Failed to revoke device." }));
        return;
      }
    }

    res.statusCode = 400;
    res.end(
      JSON.stringify({
        success: false,
        error: "Invalid action. Supported actions: APPROVE, REJECT, REVOKE_DEVICE.",
      })
    );
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ success: false, error: "Method not allowed. Use GET, POST, or PATCH." }));
}
