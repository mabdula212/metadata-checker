import type { IncomingMessage, ServerResponse } from "http";
import {
  extractSessionToken,
  destroySession,
  buildClearSessionCookie,
  logAuditEvent,
  validateRequestSession,
} from "../../lib/auth/index.js";

/**
 * API Handler for User Logout.
 * Method: POST /api/auth/logout
 */
export default async function logoutHandler(
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
    const user = await validateRequestSession(req);
    const token = extractSessionToken(req);

    if (token) {
      await destroySession(token);
    }

    if (user) {
      await logAuditEvent({
        userId: user.id,
        action: "LOGOUT",
        entityType: "USER",
        entityId: user.id,
      });
    }

    res.setHeader("Set-Cookie", buildClearSessionCookie());
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, message: "Logged out successfully." }));
  } catch (err) {
    console.error("[LOGOUT_ERROR]", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: "Error during logout." }));
  }
}
