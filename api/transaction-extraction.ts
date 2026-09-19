import type { IncomingMessage, ServerResponse } from "http";
import {
  runTransactionExtractionOnDocument,
  getTransactionsForDocument,
} from "../lib/db/documents";

/**
 * Server-side API handler for Bank Statement Transaction Extraction.
 * Method: POST /api/transaction-extraction
 * Body: { "documentId": "uuid-of-document" }
 *
 * Also supports: GET /api/transaction-extraction?documentId=... to retrieve existing transactions.
 */
export default async function transactionExtractionHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  // Support GET to fetch already extracted transactions
  if (req.method === "GET") {
    try {
      const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const documentId = url.searchParams.get("documentId");

      if (!documentId) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: false, error: "Missing documentId parameter." }));
        return;
      }

      const statement = await getTransactionsForDocument(documentId);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: true,
          statement,
        })
      );
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error fetching transactions";
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: false, error: msg }));
      return;
    }
  }

  // Only permit POST for extraction
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

    // Optional direct buffer if client provided fileBase64
    let directBuffer: Buffer | undefined;
    if (
      typeof parsedBody.fileBase64 === "string" &&
      parsedBody.fileBase64.length > 0
    ) {
      try {
        directBuffer = Buffer.from(parsedBody.fileBase64, "base64");
      } catch {
        // fallback to stored document buffer
      }
    }

    // Execute transaction extraction
    const result = await runTransactionExtractionOnDocument(documentId, directBuffer);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        documentId: result.documentId,
        statementId: result.statementId,
        status: result.status,
        summary: result.summary,
        transactions: result.transactions,
        reviewRows: result.reviewRows,
        validation: result.validation,
        warning: result.warning,
        job: result.job,
      })
    );
  } catch (error: unknown) {
    const rawError =
      error instanceof Error ? error.message : "Transaction extraction processing error";

    // Sanitize any system internals or database URLs
    const sanitizedError = rawError
      .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
      .replace(/\/[a-zA-Z0-9_\-./]+\//g, "");

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
