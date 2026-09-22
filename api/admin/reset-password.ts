import type { IncomingMessage, ServerResponse } from "http";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/db/prisma";
import {
  requireRole,
  hashPassword,
  validatePasswordStrength,
  destroyAllUserSessions,
  logAuditEvent,
  checkRateLimit,
  sanitizeClientErrorMessage,
} from "../../lib/auth";

/**
 * Admin Password Reset Handler.
 * Method: POST /api/admin/reset-password
 * Body: { "userId": "...", "newPassword": "..." }
 */
export default async function adminResetPasswordHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST." }));
    return;
  }

  // Server-side RBAC: Only ADMIN
  const adminUser = await requireRole(req, res, [Role.ADMIN]);
  if (!adminUser) return;

  // Rate limiting on password resets: 10 per minute per admin IP
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";
  const rateKey = `admin-pwd-reset:${clientIp}:${adminUser.id}`;
  const rateCheck = checkRateLimit(rateKey, 10, 60 * 1000);
  if (!rateCheck.allowed) {
    res.statusCode = 429;
    res.setHeader("Retry-After", rateCheck.retryAfterSeconds.toString());
    res.end(
      JSON.stringify({
        success: false,
        error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSeconds} seconds before resetting another password.`,
      })
    );
    return;
  }

  try {
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
        res.end(JSON.stringify({ success: false, error: "Invalid JSON body." }));
        return;
      }
    }

    const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!targetUserId || !newPassword) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: "userId and newPassword are required." }));
      return;
    }

    const pwdCheck = validatePasswordStrength(newPassword);
    if (!pwdCheck.valid) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: pwdCheck.reason }));
      return;
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: "Target user not found." }));
      return;
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: targetUserId },
      data: { passwordHash },
    });

    // Invalidate existing sessions for security
    await destroyAllUserSessions(targetUserId);

    await logAuditEvent({
      userId: adminUser.id,
      action: "PASSWORD_RESET",
      entityType: "USER",
      entityId: targetUserId,
      metadata: { targetEmail: targetUser.email },
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, message: "Password successfully reset." }));
  } catch (err) {
    console.error("[ADMIN_RESET_PASSWORD_ERROR]", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: sanitizeClientErrorMessage(err, "Failed to reset password.") }));
  }
}
