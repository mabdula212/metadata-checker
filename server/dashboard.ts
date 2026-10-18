import type { IncomingMessage, ServerResponse } from "http";
import { requireAuth, logAuditEvent, sanitizeClientErrorMessage } from "../lib/auth/index.js";
import { getDashboardData } from "../lib/db/documents.js";

/**
 * API handler for GET /api/dashboard.
 * Delivers aggregated metrics (documents analyzed, transactions extracted,
 * items needing review, storage used), recent documents, and bank distribution.
 *
 * Requirements:
 * - Requires authentication
 * - Enforces ownership (strictly isolated to authenticated user)
 * - Excludes soft-deleted documents
 */
export default async function dashboardHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(
      JSON.stringify({
        success: false,
        error: "Method not allowed. Use GET.",
      })
    );
    return;
  }

  // 1. Authenticate user
  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  try {
    // 2. Fetch dashboard statistics strictly scoped to authenticated user ID
    const dashboardData = await getDashboardData(authUser.id);

    // 3. Record audit event
    await logAuditEvent({
      userId: authUser.id,
      action: "DASHBOARD_VIEWED",
      entityType: "DASHBOARD",
      metadata: {
        documentsAnalyzed: dashboardData.stats.documentsAnalyzed,
        transactionsExtracted: dashboardData.stats.transactionsExtracted,
      },
    }).catch(() => null);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        data: dashboardData,
      })
    );
  } catch (err: unknown) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: sanitizeClientErrorMessage(err, "Failed to retrieve dashboard statistics."),
      })
    );
  }
}
