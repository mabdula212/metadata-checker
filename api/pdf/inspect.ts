import type { IncomingMessage, ServerResponse } from "http";
import { Readable } from "stream";
import Busboy from "busboy";
import {
  inspectPdfMetadata,
  createStableByteCopy,
  createStableBufferCopy,
  MAX_PDF_SIZE_BYTES,
} from "../../lib/pdf/pdf-inspector.js";
import { processAndSaveDocument } from "../../lib/db/documents.js";
import { requireAuth, logAuditEvent } from "../../lib/auth/index.js";
import { assertStorageConfigured } from "../../lib/storage/index.js";

interface ParsedUpload {
  fileName: string;
  bytes: Uint8Array;
  buffer: Buffer;
}

/**
 * Parses an incoming HTTP request for uploaded PDF data.
 * Supports web request.formData(), Node multipart/form-data, and application/json (base64).
 * Creates a stable, independent byte representation immediately upon receiving file bytes.
 */
async function parseRequestPayload(req: IncomingMessage): Promise<ParsedUpload> {
  // Case A: Web Standard Request or framework with req.formData()
  if (typeof (req as unknown as { formData?: () => Promise<FormData> }).formData === "function") {
    try {
      const formData = await (req as unknown as { formData: () => Promise<FormData> }).formData();
      const fileItem = formData.get("file") || formData.get("pdf") || formData.get("document");
      if (fileItem && typeof (fileItem as Blob).arrayBuffer === "function") {
        const file = fileItem as File;
        const sourceArrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(sourceArrayBuffer.slice(0));
        const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const fileName = (file as { name?: string }).name || "document.pdf";
        return { fileName, bytes, buffer };
      }
    } catch {
      // Fall through to streaming / busboy parsing
    }
  }

  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";

    // Case B: Handle multipart/form-data
    if (contentType.includes("multipart/form-data")) {
      const busboy = Busboy({
        headers: req.headers,
        limits: {
          fileSize: MAX_PDF_SIZE_BYTES,
          files: 1,
        },
      });

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
          // File chunks collected
        });
      });

      busboy.on("finish", () => {
        if (limitExceeded) {
          return reject(new Error("File size exceeds 20 MB limit."));
        }
        if (chunks.length === 0) {
          return reject(new Error("No file was uploaded or the uploaded file is empty."));
        }
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        if (totalLength === 0) {
          return reject(new Error("No file was uploaded or the uploaded file is empty."));
        }

        // Allocate a dedicated, non-shared ArrayBuffer slice
        const stableArrayBuffer = new ArrayBuffer(totalLength);
        const stableBytes = new Uint8Array(stableArrayBuffer);
        let offset = 0;
        for (const chunk of chunks) {
          stableBytes.set(
            new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
            offset
          );
          offset += chunk.byteLength;
        }

        const stableBuffer = Buffer.from(stableArrayBuffer);
        resolve({ fileName: originalFileName, bytes: stableBytes, buffer: stableBuffer });
      });

      busboy.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Multipart parsing error";
        reject(new Error(`Failed to parse file upload: ${msg}`));
      });

      // Handle Vercel serverless pre-buffered req.body if stream was already consumed
      const reqWithBody = req as unknown as { body?: unknown; readableEnded?: boolean };
      if (reqWithBody.body && reqWithBody.readableEnded) {
        const bodyBuf = Buffer.isBuffer(reqWithBody.body)
          ? reqWithBody.body
          : typeof reqWithBody.body === "string"
          ? Buffer.from(reqWithBody.body)
          : null;
        if (bodyBuf) {
          Readable.from(bodyBuf).pipe(busboy);
          return;
        }
      }

      req.pipe(busboy);
      return;
    }

    // Case C: Handle application/json with Base64 payload
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
          const rawBuffer = Buffer.from(base64Data, "base64");
          const stableBytes = createStableByteCopy(rawBuffer);
          const stableBuffer = createStableBufferCopy(stableBytes);
          const fileName = data.fileName || "document.pdf";
          resolve({ fileName, bytes: stableBytes, buffer: stableBuffer });
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

    // Case D: Reject unsupported content types
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

  // Validate storage configuration before document processing
  try {
    assertStorageConfigured();
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : "Production storage is not configured.";
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        success: false,
        error: rawMsg.includes("Production storage is not configured")
          ? "Production storage is not configured."
          : rawMsg,
      })
    );
    return;
  }

  try {
    console.log("[PDF_INSPECT] request received");

    // 1. Parse and extract uploaded file
    const { fileName, buffer, bytes } = await parseRequestPayload(req);
    console.log("[PDF_INSPECT] file bytes loaded");
    console.log("[PDF_INSPECT] stable byte copy created");

    // 2. Perform server-side metadata inspection and validation
    // Uses stable independent byte representation (validates magic bytes, sha256, pdf-lib)
    const extractedMetadata = await inspectPdfMetadata(bytes || buffer);

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
    let sanitizedMessage: string;
    let statusCode = 500;

    const isStorageConfigError =
      rawMessage.includes("Production storage is not configured") ||
      rawMessage.includes("BLOB_READ_WRITE_TOKEN");

    const isStorageError =
      rawMessage.includes("Vercel Blob") ||
      rawMessage.includes("DEPLOYMENT_NOT_FOUND") ||
      rawMessage.includes("Deployment could not be found") ||
      (rawMessage.includes("storage") && rawMessage.includes("ENOENT"));

    if (isStorageConfigError) {
      statusCode = 503;
      sanitizedMessage = "Production storage is not configured.";
    } else if (isStorageError) {
      statusCode = 500;
      sanitizedMessage = "Document storage processing failed. Please try again later.";
    } else if (
      rawMessage.includes("Invalid PDF") ||
      rawMessage.includes("corrupted") ||
      rawMessage.includes("Failed to parse PDF metadata") ||
      rawMessage.includes("PDF file size exceeds") ||
      rawMessage.includes("File is empty")
    ) {
      statusCode = 400;
      sanitizedMessage = rawMessage.slice(0, 300);
    } else {
      statusCode = 400;
      sanitizedMessage = rawMessage
        .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
        .replace(/\/var\/task\/[^\s]+/gi, "[server-path]")
        .replace(/[\/\\][a-zA-Z0-9_\-./]+\/(storage|documents)[^\s]*/gi, "[storage-path]")
        .slice(0, 300);
    }

    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: sanitizedMessage,
      })
    );
  }
}
