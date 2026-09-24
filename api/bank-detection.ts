import type { IncomingMessage, ServerResponse } from "http";
import { runBankDetectionOnDocument } from "../lib/db/documents.js";
import { requireDocumentOwner, logAuditEvent } from "../lib/auth/index.js";

/**
 * Server-side API handler for Bank Statement Detection.
 * Method: POST /api/bank-detection
 * Body: { "documentId": "uuid-of-document" }
 */
export default async function bankDetectionHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  // Only permit POST requests
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "Method Not Allowed. Use POST.",
      })
    );
    return;
  }

  try {
    // Read request body
    const buffers: Buffer[] = [];
    for await (const chunk of req) {
      buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bodyStr = Buffer.concat(buffers).toString("utf-8");

    let parsedBody: Record<string, unknown> = {};
    if (bodyStr.trim()) {
      try {
        parsedBody = JSON.parse(bodyStr);
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
      typeof parsedBody.documentId === "string" ? parsedBody.documentId : null;

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

    // Enforce authentication & document ownership (IDOR defense)
    const ownerCheck = await requireDocumentOwner(req, res, documentId);
    if (!ownerCheck) return;

    // Optional direct buffer if client provided fileBase64 as fallback
    let directBuffer: Buffer | undefined;
    if (
      typeof parsedBody.fileBase64 === "string" &&
      parsedBody.fileBase64.length > 0
    ) {
      try {
        directBuffer = Buffer.from(parsedBody.fileBase64, "base64");
      } catch {
        // Ignore base64 parse failure, will fallback to stored document
      }
    }

    // Execute bank detection workflow
    const result = await runBankDetectionOnDocument(documentId, directBuffer);

    // Record audit event
    await logAuditEvent({
      userId: ownerCheck.user.id,
      action: "BANK_DETECTION_RUN",
      entityType: "DOCUMENT",
      entityId: documentId,
      metadata: {
        bankName: result.statement?.bankName,
        confidence: result.detection?.confidence,
      },
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        ...result,
      })
    );
  } catch (error: unknown) {
    const rawError =
      error instanceof Error ? error.message : "Bank detection processing error";

    let sanitizedError: string;
    if (
      rawError.includes("Production storage is not configured") ||
      rawError.includes("BLOB_READ_WRITE_TOKEN")
    ) {
      sanitizedError = "Production storage is not configured.";
    } else {
      sanitizedError = rawError
        .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
        .replace(/\/var\/task\/[^\s]+/gi, "[server-path]")
        .replace(/[\/\\][a-zA-Z0-9_\-./]+\/(storage|documents)[^\s]*/gi, "[storage-path]")
        .replace(/\/[a-zA-Z0-9_\-./]+\//g, "");
    }

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: sanitizedError,
      })
    );
  }
}
