import type { IncomingMessage, ServerResponse } from "http";
import Busboy from "busboy";
import { inspectPdfMetadata, MAX_PDF_SIZE_BYTES } from "../../lib/pdf/pdf-inspector";
import { processAndSaveDocument } from "../../lib/db/documents";
import { requireAuth, logAuditEvent } from "../../lib/auth";

interface ParsedUpload {
  fileName: string;
  buffer: Buffer;
}

/**
 * Parses an incoming HTTP request for uploaded PDF data.
 * Supports multipart/form-data, application/json (base64), and raw binary streams.
 */
function parseRequestPayload(req: IncomingMessage): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";

    // 1. Handle multipart/form-data
    if (contentType.includes("multipart/form-data")) {
      const busboy = Busboy({
        headers: req.headers,
        limits: {
          fileSize: MAX_PDF_SIZE_BYTES,
          files: 1,
        },
      });

      let fileBuffer: Buffer | null = null;
      let originalFileName = "document.pdf";
      const chunks: Buffer[] = [];
      let limitExceeded = false;

      busboy.on("file", (_fieldname, file, info) => {
        originalFileName = info.filename || "document.pdf";

        file.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        file.on("limit", () => {
          limitExceeded = true;
        });

        file.on("end", () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      busboy.on("finish", () => {
        if (limitExceeded) {
          return reject(new Error("File size exceeds 20 MB limit."));
        }
        if (!fileBuffer || fileBuffer.length === 0) {
          return reject(new Error("No file was uploaded or the uploaded file is empty."));
        }
        resolve({ fileName: originalFileName, buffer: fileBuffer });
      });

      busboy.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Multipart parsing error";
        reject(new Error(`Failed to parse file upload: ${msg}`));
      });

      req.pipe(busboy);
      return;
    }

    // 2. Handle application/json with Base64 payload
    if (contentType.includes("application/json")) {
      const chunks: Buffer[] = [];
      let totalLength = 0;

      req.on("data", (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > MAX_PDF_SIZE_BYTES * 1.5) {
          reject(new Error("Payload exceeds maximum size limit."));
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        try {
          const bodyStr = Buffer.concat(chunks).toString("utf-8");
          const data = JSON.parse(bodyStr);
          if (!data.fileBase64) {
            return reject(new Error("Missing fileBase64 in JSON request body."));
          }
          const base64Data = data.fileBase64.replace(/^data:[^;]+;base64,/, "");
          const fileBuffer = Buffer.from(base64Data, "base64");
          const fileName = data.fileName || "document.pdf";
          resolve({ fileName, buffer: fileBuffer });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Invalid JSON";
          reject(new Error(`Failed to parse JSON body: ${msg}`));
        }
      });

      req.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Stream read error";
        reject(new Error(`Stream error: ${msg}`));
      });
      return;
    }

    // 3. Reject unsupported content types
    reject(new Error(`Unsupported content type: ${contentType}. Please upload as multipart/form-data.`));
  });
}

/**
 * Server-side PDF Inspection and Metadata Extraction API handler.
 * Compatible with Node.js and Vercel serverless function invocation.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");

  // Only allow POST
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST." }));
    return;
  }

  // Require active authentication
  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  try {
    // 1. Parse and extract uploaded file
    const { fileName, buffer } = await parseRequestPayload(req);

    // 2. Perform server-side metadata inspection and validation
    const extractedMetadata = await inspectPdfMetadata(buffer);

    // 3. Process and persist document + metadata + processing job under authenticated user
    const result = await processAndSaveDocument({
      originalFileName: fileName,
      fileSize: buffer.length,
      buffer,
      extractedMetadata,
      userId: authUser.id,
    });

    // 4. Record audit event
    await logAuditEvent({
      userId: authUser.id,
      action: "DOCUMENT_UPLOADED",
      entityType: "DOCUMENT",
      entityId: result.document.id,
      metadata: {
        fileName,
        fileSize: buffer.length,
        isDuplicate: result.isDuplicate,
      },
    });

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        isDuplicate: result.isDuplicate,
        message: result.isDuplicate
          ? "This PDF has already been analyzed."
          : "PDF metadata successfully extracted and saved.",
        data: {
          document: result.document,
          metadata: result.metadata,
          job: result.job,
        },
      })
    );
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "An unexpected processing error occurred.";
    // Clean sensitive database connection info or file system paths
    const sanitizedMessage = rawMessage
      .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
      .slice(0, 300);

    res.statusCode = 400;
    res.end(
      JSON.stringify({
        success: false,
        error: sanitizedMessage,
      })
    );
  }
}
