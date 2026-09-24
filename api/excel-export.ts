import type { IncomingMessage, ServerResponse } from "http";
import { exportBankStatementToExcel, getExportFile } from "../lib/excel/index.js";
import { requireDocumentOwner, requireExportOwner, logAuditEvent } from "../lib/auth/index.js";

/**
 * API handler for Bank Statement Excel Export Engine.
 *
 * Endpoints:
 * - POST /api/excel-export
 *   Body: { "documentId": "..." }
 *   Enforces document ownership. Generates XLSX, stores in StorageProvider, saves Export DB record.
 *
 * - GET /api/excel-export/:exportId (or /api/excel-export?exportId=...)
 *   Enforces export ownership (IDOR defense). Streams the generated XLSX binary directly.
 */
export default async function excelExportHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  // -------------------------------------------------------------
  // GET: Download existing generated Excel file
  // -------------------------------------------------------------
  if (req.method === "GET") {
    let exportId: string | null = urlObj.searchParams.get("exportId");

    // Also parse from path: /api/excel-export/:exportId
    if (!exportId && pathname.startsWith("/api/excel-export/")) {
      const parts = pathname.replace(/^\/api\/excel-export\/?/, "").split("/");
      if (parts[0] && parts[0].trim().length > 0) {
        exportId = decodeURIComponent(parts[0]);
      }
    }

    if (!exportId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: "Missing required 'exportId' parameter.",
        })
      );
      return;
    }

    // Enforce export ownership (IDOR defense)
    const exportCheck = await requireExportOwner(req, res, exportId);
    if (!exportCheck) return;

    try {
      const fileData = await getExportFile(exportId);

      res.statusCode = 200;
      res.setHeader("Content-Type", fileData.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(fileData.fileName)}"`
      );
      res.setHeader("Content-Length", fileData.buffer.length);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(fileData.buffer);
      return;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : "Failed to retrieve export file.";
      const is404 = rawMsg.toLowerCase().includes("not found");
      res.statusCode = is404 ? 404 : 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: rawMsg.slice(0, 200),
        })
      );
      return;
    }
  }

  // -------------------------------------------------------------
  // POST: Generate Excel export
  // -------------------------------------------------------------
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "Method Not Allowed. Use POST to generate export or GET to download.",
      })
    );
    return;
  }

  try {
    // Read request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bodyText = Buffer.concat(chunks).toString("utf-8");

    let parsedBody: Record<string, unknown> = {};
    if (bodyText.trim()) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            success: false,
            error: "Invalid JSON request body.",
          })
        );
        return;
      }
    }

    const documentId =
      typeof parsedBody.documentId === "string" ? parsedBody.documentId.trim() : null;

    if (!documentId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: "Missing required 'documentId' in request body.",
        })
      );
      return;
    }

    // Enforce document ownership (IDOR defense)
    const docCheck = await requireDocumentOwner(req, res, documentId);
    if (!docCheck) return;

    const forceRegenerate = Boolean(parsedBody.forceRegenerate);

    const result = await exportBankStatementToExcel({
      documentId,
      forceRegenerate,
      userId: docCheck.user.id,
    });

    // Record audit event
    await logAuditEvent({
      userId: docCheck.user.id,
      action: "EXCEL_EXPORTED",
      entityType: "DOCUMENT",
      entityId: documentId,
      metadata: {
        exportId: result.exportId,
        fileName: result.fileName,
        transactionCount: result.transactionCount,
      },
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        exportId: result.exportId,
        fileName: result.fileName,
        format: result.format,
        fileSize: result.fileSize,
        transactionCount: result.transactionCount,
        reviewCount: result.reviewCount,
        createdAt: result.createdAt.toISOString(),
        downloadUrl: `/api/excel-export/${result.exportId}`,
      })
    );
  } catch (error: unknown) {
    const rawError =
      error instanceof Error ? error.message : "Excel export processing error.";

    let statusCode = 500;
    if (rawError.includes("Document not found")) {
      statusCode = 404;
    } else if (
      rawError.includes("No transaction data is available") ||
      rawError.includes("Complete transaction extraction") ||
      rawError.includes("Cannot export: transaction extraction status is FAILED") ||
      rawError.includes("Invalid document ID")
    ) {
      statusCode = 400;
    }

    const sanitizedError = rawError
      .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
      .replace(/\/[a-zA-Z0-9_\-./]+\//g, "")
      .slice(0, 255);

    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: sanitizedError,
      })
    );
  }
}
