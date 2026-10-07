import type { IncomingMessage, ServerResponse } from "http";
import { Role, UserStatus } from "@prisma/client";
import { prisma } from "../../lib/db/prisma.js";
import {
  requireRole,
  hashPassword,
  validatePasswordStrength,
  destroyAllUserSessions,
  logAuditEvent,
  adminLoginRequestsHandler,
} from "../../lib/auth/index.js";

/**
 * Admin User Management & Device Login Requests Handler.
 * Endpoints:
 * - GET   /api/admin/users
 * - POST  /api/admin/users
 * - PATCH /api/admin/users
 * - GET/POST/PATCH /api/admin/login-requests (via Vercel rewrite)
 */
export default async function adminUsersHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  const url = req.url || "/api/admin/users";
  if (
    url.includes("/api/admin/login-requests") ||
    url.includes("__route=login-requests")
  ) {
    return adminLoginRequestsHandler(req, res);
  }

  res.setHeader("Content-Type", "application/json");

  // Server-side RBAC enforcement: Only ADMIN can access
  const adminUser = await requireRole(req, res, [Role.ADMIN]);
  if (!adminUser) return;

  // -------------------------------------------------------------
  // GET: List all users (including passwordPlain for Admin)
  // -------------------------------------------------------------
  if (req.method === "GET") {
    try {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          passwordPlain: true,
          createdAt: true,
          updatedAt: true,
          devices: {
            where: { status: "ACTIVE" },
            take: 1,
            orderBy: { lastSeenAt: "desc" },
            select: {
              id: true,
              deviceName: true,
              browser: true,
              operatingSystem: true,
              status: true,
              lastSeenAt: true,
            },
          },
          _count: {
            select: {
              documents: true,
              exports: true,
              loginRequests: {
                where: { status: "PENDING" },
              },
            },
          },
        },
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          users: users.map((u) => {
            const activeDev = u.devices[0] || null;
            return {
              id: u.id,
              email: u.email,
              name: u.name,
              role: u.role,
              status: u.status,
              passwordPlain: u.passwordPlain || null,
              createdAt: u.createdAt.toISOString(),
              updatedAt: u.updatedAt.toISOString(),
              documentCount: u._count.documents,
              exportCount: u._count.exports,
              pendingDeviceRequests: u._count.loginRequests,
              activeDevice: activeDev
                ? {
                    id: activeDev.id,
                    deviceName: activeDev.deviceName,
                    browser: activeDev.browser,
                    operatingSystem: activeDev.operatingSystem,
                    status: activeDev.status,
                    lastSeenAt: activeDev.lastSeenAt.toISOString(),
                  }
                : null,
            };
          }),
        })
      );
      return;
    } catch (err) {
      console.error("[ADMIN_USERS_GET_ERROR]", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: "Failed to list users." }));
      return;
    }
  }

  // -------------------------------------------------------------
  // Read JSON body for POST, PATCH, and DELETE
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // POST: Create a new user
  // -------------------------------------------------------------
  if (req.method === "POST") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : null;
    const password = typeof body.password === "string" ? body.password : "";
    const requestedRole = body.role === "ADMIN" ? Role.ADMIN : Role.USER;
    const requestedStatus =
      body.status === "PENDING"
        ? UserStatus.PENDING
        : body.status === "DEACTIVATED"
        ? UserStatus.DEACTIVATED
        : UserStatus.ACTIVE;

    if (!email || !email.includes("@")) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "A valid email address is required." }));
      return;
    }

    const pwdValidation = validatePasswordStrength(password);
    if (!pwdValidation.valid) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: pwdValidation.reason }));
      return;
    }

    try {
      // Check if user already exists
      const existing = await prisma.user.findUnique({
        where: { email },
      });

      if (existing) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: "A user with this email address already exists." }));
        return;
      }

      const passwordHash = await hashPassword(password);

      const newUser = await prisma.user.create({
        data: {
          email,
          name,
          role: requestedRole,
          status: requestedStatus,
          passwordHash,
          passwordPlain: password,
        },
      });

      await logAuditEvent({
        userId: adminUser.id,
        action: "USER_CREATED",
        entityType: "USER",
        entityId: newUser.id,
        metadata: { createdEmail: newUser.email, role: newUser.role, status: newUser.status },
      });

      res.statusCode = 201;
      res.end(
        JSON.stringify({
          success: true,
          user: {
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role,
            status: newUser.status,
            passwordPlain: newUser.passwordPlain,
            createdAt: newUser.createdAt.toISOString(),
          },
        })
      );
      return;
    } catch (err) {
      console.error("[ADMIN_USER_CREATE_ERROR]", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: "Failed to create user." }));
      return;
    }
  }

  // -------------------------------------------------------------
  // PATCH: Update user status (Approve/Restrict), role, profile, or password
  // -------------------------------------------------------------
  if (req.method === "PATCH") {
    const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    const nextRole = body.role === "ADMIN" ? Role.ADMIN : body.role === "USER" ? Role.USER : undefined;
    const nextStatus =
      body.status === "ACTIVE"
        ? UserStatus.ACTIVE
        : body.status === "PENDING"
        ? UserStatus.PENDING
        : body.status === "DEACTIVATED"
        ? UserStatus.DEACTIVATED
        : undefined;
    const nextName = typeof body.name === "string" ? body.name.trim() : undefined;
    const nextEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
    const nextPassword = typeof body.password === "string" && body.password.trim() ? body.password : undefined;

    if (!targetUserId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Missing required 'userId' in request body." }));
      return;
    }

    try {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
      });

      if (!targetUser) {
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false, error: "User not found." }));
        return;
      }

      // Safeguard: Prevent admin from deactivating, suspending, or demoting themselves
      if (targetUser.id === adminUser.id) {
        if (nextStatus === UserStatus.DEACTIVATED || nextStatus === UserStatus.PENDING) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: "Anda tidak dapat menonaktifkan akun Admin Anda sendiri." }));
          return;
        }
        if (nextRole === Role.USER) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: "Anda tidak dapat mencabut hak akses Admin Anda sendiri." }));
          return;
        }
      }

      const updateData: {
        role?: Role;
        status?: UserStatus;
        name?: string | null;
        email?: string;
        passwordHash?: string;
        passwordPlain?: string;
      } = {};
      if (nextRole && nextRole !== targetUser.role) {
        updateData.role = nextRole;
      }
      if (nextStatus && nextStatus !== targetUser.status) {
        updateData.status = nextStatus;
      }
      if (nextName !== undefined && nextName !== (targetUser.name || "")) {
        updateData.name = nextName || null;
      }
      if (nextEmail && nextEmail.includes("@") && nextEmail !== targetUser.email) {
        const emailExists = await prisma.user.findUnique({ where: { email: nextEmail } });
        if (emailExists && emailExists.id !== targetUserId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: "Email tersebut sudah digunakan oleh pengguna lain." }));
          return;
        }
        updateData.email = nextEmail;
      }
      if (nextPassword) {
        const pwdCheck = validatePasswordStrength(nextPassword);
        if (!pwdCheck.valid) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: pwdCheck.reason }));
          return;
        }
        updateData.passwordHash = await hashPassword(nextPassword);
        updateData.passwordPlain = nextPassword;
      }

      if (Object.keys(updateData).length === 0) {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, message: "No changes requested.", user: targetUser }));
        return;
      }

      const updated = await prisma.user.update({
        where: { id: targetUserId },
        data: updateData,
      });

      if (updateData.passwordHash && targetUserId !== adminUser.id) {
        await destroyAllUserSessions(targetUserId);
      }

      // If deactivated or suspended to pending, revoke all active sessions immediately
      if (updateData.status === UserStatus.DEACTIVATED || updateData.status === UserStatus.PENDING) {
        await destroyAllUserSessions(targetUserId);
        await logAuditEvent({
          userId: adminUser.id,
          action: updateData.status === UserStatus.DEACTIVATED ? "USER_DISABLED" : "USER_SET_PENDING",
          entityType: "USER",
          entityId: targetUserId,
          metadata: { targetEmail: updated.email, previousStatus: targetUser.status, newStatus: updateData.status },
        });
      } else if (updateData.status === UserStatus.ACTIVE) {
        await logAuditEvent({
          userId: adminUser.id,
          action: targetUser.status === UserStatus.PENDING ? "USER_APPROVED" : "USER_ACTIVATED",
          entityType: "USER",
          entityId: targetUserId,
          metadata: { targetEmail: updated.email, previousStatus: targetUser.status },
        });
      }

      if (updateData.role) {
        await logAuditEvent({
          userId: adminUser.id,
          action: "ROLE_CHANGED",
          entityType: "USER",
          entityId: targetUserId,
          metadata: { targetEmail: updated.email, newRole: updateData.role },
        });
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          user: {
            id: updated.id,
            email: updated.email,
            name: updated.name,
            role: updated.role,
            status: updated.status,
            updatedAt: updated.updatedAt.toISOString(),
          },
        })
      );
      return;
    } catch (err) {
      console.error("[ADMIN_USER_UPDATE_ERROR]", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: "Failed to update user." }));
      return;
    }
  }

  // -------------------------------------------------------------
  // DELETE: Permanently delete one or multiple user accounts
  // -------------------------------------------------------------
  if (req.method === "DELETE") {
    const urlObj = new URL(req.url || "/api/admin/users", "http://localhost");

    // Check if bulk userIds array is provided
    const rawUserIds = Array.isArray(body.userIds) ? body.userIds : null;

    if (rawUserIds) {
      const requestedIds = Array.from(
        new Set(
          rawUserIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean)
        )
      );

      if (requestedIds.length === 0) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            success: false,
            error: "Pilih minimal satu akun pengguna untuk dihapus.",
          })
        );
        return;
      }

      const deletableIds = requestedIds.filter((id) => id !== adminUser.id);
      if (deletableIds.length === 0) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            success: false,
            error: "Anda tidak dapat menghapus akun Admin Anda sendiri.",
          })
        );
        return;
      }

      try {
        const targetUsers = await prisma.user.findMany({
          where: { id: { in: deletableIds } },
          select: { id: true, email: true, role: true },
        });

        if (targetUsers.length === 0) {
          res.statusCode = 404;
          res.end(
            JSON.stringify({
              success: false,
              error: "Akun pengguna yang dipilih tidak ditemukan.",
            })
          );
          return;
        }

        const foundIds = targetUsers.map((u) => u.id);

        await prisma.session.deleteMany({
          where: { userId: { in: foundIds } },
        });

        const deleteResult = await prisma.user.deleteMany({
          where: { id: { in: foundIds } },
        });

        await logAuditEvent({
          userId: adminUser.id,
          action: "USERS_BULK_DELETED",
          entityType: "USER",
          metadata: {
            deletedCount: deleteResult.count,
            deletedUsers: targetUsers.map((u) => ({
              id: u.id,
              email: u.email,
              role: u.role,
            })),
          },
        });

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: true,
            deletedCount: deleteResult.count,
            deletedIds: foundIds,
            message: `${deleteResult.count} akun pengguna berhasil dihapus secara permanen.`,
          })
        );
        return;
      } catch (err) {
        console.error("[ADMIN_USERS_BULK_DELETE_ERROR]", err);
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            success: false,
            error: "Gagal menghapus beberapa akun pengguna sekaligus.",
          })
        );
        return;
      }
    }

    const targetUserId =
      (typeof body.userId === "string" ? body.userId.trim() : "") ||
      urlObj.searchParams.get("userId")?.trim() ||
      "";

    if (!targetUserId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Missing required 'userId' or 'userIds'." }));
      return;
    }

    if (targetUserId === adminUser.id) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Anda tidak dapat menghapus akun Admin Anda sendiri." }));
      return;
    }

    try {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
      });

      if (!targetUser) {
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false, error: "User not found." }));
        return;
      }

      await destroyAllUserSessions(targetUserId);
      await prisma.user.delete({
        where: { id: targetUserId },
      });

      await logAuditEvent({
        userId: adminUser.id,
        action: "USER_DELETED",
        entityType: "USER",
        entityId: targetUserId,
        metadata: { deletedEmail: targetUser.email, deletedRole: targetUser.role },
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          message: `Akun pengguna ${targetUser.email} berhasil dihapus.`,
        })
      );
      return;
    } catch (err) {
      console.error("[ADMIN_USER_DELETE_ERROR]", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: "Failed to delete user." }));
      return;
    }
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ success: false, error: "Method not allowed. Use GET, POST, PATCH, or DELETE." }));
}
