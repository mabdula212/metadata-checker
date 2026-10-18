import type { IncomingMessage, ServerResponse } from "http";
import { Role } from "@prisma/client";
import {
  requireAuth,
  logAuditEvent,
  sanitizeClientErrorMessage,
} from "../lib/auth/index.js";
import {
  getDocumentHistory,
  getDocumentDetail,
  softDeleteDocument,
} from "../lib/db/documents.js";

/**
 * API handler for Document Management & History.
 *
 * Supported Endpoints:
 * - GET /api/documents
 *   Query params: search, bank, status, startDate, endDate, page, limit, sortBy, sortOrder
 *   Enforces authentication & strict user data isolation.
 *
 * - GET /api/documents/:documentId
 *   Retrieves document details, statement, metadata, transactions, exports.
 *   Enforces ownership (IDOR defense) and updates lastAccessedAt.
 *
 * - DELETE /api/documents/:documentId
 *   Soft-deletes a document owned by the user (sets deletedAt).
 *   Enforces ownership and records audit log.
 */
export default async function documentsHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader("Content-Type", "application/json");

  // 1. Authenticate user for all document operations
  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  // Extract documentId from URL query or path
  let documentId: string | null = urlObj.searchParams.get("documentId");
  if (!documentId && pathname.startsWith("/api/documents/")) {
    const segments = pathname.replace(/^\/api\/documents\/?/, "").split("/");
    if (segments[0] && segments[0].trim().length > 0 && segments[0] !== "recent") {
      documentId = decodeURIComponent(segments[0]);
    }
  }

  const isAdmin = authUser.role === Role.ADMIN;

  try {
    // -------------------------------------------------------------
    // Branch 1: Single Document Operations (:documentId present)
    // -------------------------------------------------------------
    if (documentId) {
      if (req.method === "GET") {
        const result = await getDocumentDetail(documentId, authUser.id, isAdmin);
        if (result.status !== 200) {
          res.statusCode = result.status;
          res.end(
            JSON.stringify({
              success: false,
              error: result.error,
            })
          );
          return;
        }

        await logAuditEvent({
          userId: authUser.id,
          action: "DOCUMENT_VIEWED",
          entityType: "DOCUMENT",
          entityId: documentId,
        }).catch(() => null);

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: true,
            data: result.data,
          })
        );
        return;
      }

      if (req.method === "DELETE") {
        const result = await softDeleteDocument(documentId, authUser.id, isAdmin);
        if (result.status !== 200) {
          res.statusCode = result.status;
          res.end(
            JSON.stringify({
              success: false,
              error: result.error,
            })
          );
          return;
        }

        await logAuditEvent({
          userId: authUser.id,
          action: "DOCUMENT_DELETED",
          entityType: "DOCUMENT",
          entityId: documentId,
        }).catch(() => null);

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: true,
            message: "Dokumen berhasil dihapus.",
          })
        );
        return;
      }

      res.statusCode = 405;
      res.end(
        JSON.stringify({
          success: false,
          error: "Method not allowed on document resource.",
        })
      );
      return;
    }

    // -------------------------------------------------------------
    // Branch 2: Collection Operations (/api/documents)
    // -------------------------------------------------------------
    if (req.method === "GET") {
      const search = urlObj.searchParams.get("search") || undefined;
      const bank = urlObj.searchParams.get("bank") || undefined;
      const status = urlObj.searchParams.get("status") || undefined;
      const startDate = urlObj.searchParams.get("startDate") || undefined;
      const endDate = urlObj.searchParams.get("endDate") || undefined;
      const page = parseInt(urlObj.searchParams.get("page") || "1", 10) || 1;
      const limit = parseInt(urlObj.searchParams.get("limit") || "10", 10) || 10;
      const sortBy = (urlObj.searchParams.get("sortBy") as any) || "createdAt";
      const sortOrder = (urlObj.searchParams.get("sortOrder") as any) || "desc";

      const history = await getDocumentHistory({
        userId: authUser.id,
        search,
        bank,
        status,
        startDate,
        endDate,
        page,
        limit,
        sortBy,
        sortOrder,
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          data: history.data,
          pagination: history.pagination,
        })
      );
      return;
    }

    res.statusCode = 405;
    res.end(
      JSON.stringify({
        success: false,
        error: "Method not allowed. Use GET or DELETE.",
      })
    );
  } catch (err: unknown) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: sanitizeClientErrorMessage(err, "An error occurred while processing documents request."),
      })
    );
  }
}
