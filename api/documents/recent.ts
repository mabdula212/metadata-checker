import type { IncomingMessage, ServerResponse } from "http";
import { Role } from "@prisma/client";
import { getRecentDocuments } from "../../lib/db/documents";
import { requireAuth, logAuditEvent } from "../../lib/auth";

/**
 * API handler to fetch recent analyzed documents.
 * Enforces authentication and strict user data isolation.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: "Method not allowed. Use GET." }));
    return;
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  try {
    // Regular users can only see their own documents; Admins can see all
    const filterUserId = authUser.role === Role.ADMIN ? undefined : authUser.id;
    const documents = await getRecentDocuments(10, filterUserId);

    // Record audit event
    await logAuditEvent({
      userId: authUser.id,
      action: "DOCUMENT_VIEWED",
      entityType: "DOCUMENT_LIST",
      metadata: { count: documents.length },
    });

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        data: documents,
      })
    );
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Failed to retrieve recent documents.";
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: rawMessage.slice(0, 200),
      })
    );
  }
}
