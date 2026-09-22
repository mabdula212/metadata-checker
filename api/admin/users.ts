import type { IncomingMessage, ServerResponse } from "http";
import { Role, UserStatus } from "@prisma/client";
import { prisma } from "../../lib/db/prisma";
import {
  requireRole,
  hashPassword,
  validatePasswordStrength,
  destroyAllUserSessions,
  logAuditEvent,
} from "../../lib/auth";

/**
 * Admin User Management Handler.
 * Endpoints:
 * - GET   /api/admin/users
 * - POST  /api/admin/users
 * - PATCH /api/admin/users
 */
export default async function adminUsersHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader("Content-Type", "application/json");

  // Server-side RBAC enforcement: Only ADMIN can access
  const adminUser = await requireRole(req, res, [Role.ADMIN]);
  if (!adminUser) return;

  // -------------------------------------------------------------
  // GET: List all users
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
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              documents: true,
              exports: true,
            },
          },
        },
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          users: users.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            status: u.status,
            createdAt: u.createdAt.toISOString(),
            documentCount: u._count.documents,
            exportCount: u._count.exports,
          })),
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
  // Read JSON body for POST and PATCH
  // -------------------------------------------------------------
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const bodyText = Buffer.concat(chunks).toString("utf-8");

  let body: Record<string, unknown> = {};
  if (bodyText.trim()) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "Invalid JSON request body." }));
      return;
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
          status: UserStatus.ACTIVE,
          passwordHash,
        },
      });

      await logAuditEvent({
        userId: adminUser.id,
        action: "USER_CREATED",
        entityType: "USER",
        entityId: newUser.id,
        metadata: { createdEmail: newUser.email, role: newUser.role },
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
  // PATCH: Update user status or role
  // -------------------------------------------------------------
  if (req.method === "PATCH") {
    const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    const nextRole = body.role === "ADMIN" ? Role.ADMIN : body.role === "USER" ? Role.USER : undefined;
    const nextStatus =
      body.status === "ACTIVE"
        ? UserStatus.ACTIVE
        : body.status === "DEACTIVATED"
        ? UserStatus.DEACTIVATED
        : undefined;

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

      // Safeguard: Prevent admin from deactivating or demoting themselves
      if (targetUser.id === adminUser.id) {
        if (nextStatus === UserStatus.DEACTIVATED) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: "You cannot deactivate your own account." }));
          return;
        }
        if (nextRole === Role.USER) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: "You cannot remove your own administrative privileges." }));
          return;
        }
      }

      const updateData: { role?: Role; status?: UserStatus } = {};
      if (nextRole && nextRole !== targetUser.role) {
        updateData.role = nextRole;
      }
      if (nextStatus && nextStatus !== targetUser.status) {
        updateData.status = nextStatus;
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

      // If deactivated, revoke all active sessions immediately
      if (updateData.status === UserStatus.DEACTIVATED) {
        await destroyAllUserSessions(targetUserId);
        await logAuditEvent({
          userId: adminUser.id,
          action: "USER_DISABLED",
          entityType: "USER",
          entityId: targetUserId,
          metadata: { targetEmail: updated.email },
        });
      } else if (updateData.status === UserStatus.ACTIVE) {
        await logAuditEvent({
          userId: adminUser.id,
          action: "USER_ACTIVATED",
          entityType: "USER",
          entityId: targetUserId,
          metadata: { targetEmail: updated.email },
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

  res.statusCode = 405;
  res.end(JSON.stringify({ success: false, error: "Method not allowed. Use GET, POST, or PATCH." }));
}
