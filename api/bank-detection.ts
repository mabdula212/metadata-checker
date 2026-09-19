import type { IncomingMessage, ServerResponse } from "http";
import { runBankDetectionOnDocument } from "../lib/db/documents";

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
