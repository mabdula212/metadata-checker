import type { IncomingMessage, ServerResponse } from "http";
import { Readable } from "stream";
import Busboy from "busboy";
import { Role, BatchStatus } from "@prisma/client";
import { prisma } from "../lib/db/prisma.js";
import {
  requireAuth,
  logAuditEvent,
  sanitizeClientErrorMessage,
} from "../lib/auth/index.js";
import {
  inspectPdfMetadata,
  createStableByteCopy,
  createStableBufferCopy,
  calculateFileHash,
  MAX_PDF_SIZE_BYTES,
} from "../lib/pdf/pdf-inspector.js";
import { isPdfBuffer } from "../lib/storage/index.js";
import {
  detectEncryption,
  decryptPdf,
  storeDecryptedBuffer,
} from "../lib/pdf/pdf-decryptor.js";
import {
  processAndSaveDocument,
  findDuplicateDocument,
  runBankDetectionOnDocument,
  runTransactionExtractionOnDocument,
} from "../lib/db/documents.js";

interface BatchUploadedFile {
  fileName: string;
  buffer: Buffer;
  bytes: Uint8Array;
  password?: string | null;
}

export interface BatchItemResult {
  documentId: string | null;
  fileName: string;
  fileSize: number;
  status: "COMPLETED" | "FAILED" | "NEEDS_REVIEW" | "PASSWORD_REQUIRED" | "CANCELLED";
  progress: number;
  error: string | null;
  bank: string | null;
  transactionCount: number;
  isDuplicate?: boolean;
}

// In-memory set of cancelled batch IDs for fast in-flight cooperative cancellation
const activeCancelledBatches = new Set<string>();

/**
 * Normalizes Indonesian bank names and codes to canonical acronyms.
 */
function normalizeBankCode(bankNameOrCode?: string | null): string | null {
  if (!bankNameOrCode) return null;
  const upper = bankNameOrCode.toUpperCase().trim();
  if (upper.includes("BCA") || upper.includes("CENTRAL ASIA")) return "BCA";
  if (upper.includes("BNI") || upper.includes("NEGARA INDONESIA")) return "BNI";
  if (upper.includes("BRI") || upper.includes("RAKYAT INDONESIA")) return "BRI";
  if (upper.includes("MANDIRI")) return "MANDIRI";
  return upper;
}

/**
 * Executes async tasks with strict concurrency control.
 * Prevents memory pressure and OOM during concurrent PDF text extraction.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  workerFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await workerFn(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Parses multipart or JSON request into a list of upload items.
 */
async function parseBatchRequest(req: IncomingMessage): Promise<{
  files: BatchUploadedFile[];
  globalPassword?: string | null;
}> {
  // Case A: Web Standard Request with formData()
  if (typeof (req as unknown as { formData?: () => Promise<FormData> }).formData === "function") {
    try {
      const formData = await (req as unknown as { formData: () => Promise<FormData> }).formData();
      const files: BatchUploadedFile[] = [];
      const globalPassword = (formData.get("password") as string) || null;

      const entries = Array.from(formData.entries());
      for (const [key, value] of entries) {
        if (value && typeof (value as Blob).arrayBuffer === "function") {
          const file = value as File;
          const ab = await file.arrayBuffer();
          const bytes = new Uint8Array(ab);
          const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          files.push({
            fileName: file.name || "document.pdf",
            bytes,
            buffer,
            password: globalPassword,
          });
        }
      }

      if (files.length > 0) {
        return { files, globalPassword };
      }
    } catch {
      // Fall through to Busboy / stream parsing
    }
  }

  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";

    // Case B: multipart/form-data
    if (contentType.includes("multipart/form-data")) {
      const busboy = Busboy({
        headers: req.headers,
        limits: {
          fileSize: MAX_PDF_SIZE_BYTES,
          files: 50,
        },
      });

      const files: BatchUploadedFile[] = [];
      let globalPassword: string | null = null;
      const filePromises: Promise<void>[] = [];

      busboy.on("field", (name, val) => {
        if (name === "password") {
          globalPassword = val;
        }
      });

      busboy.on("file", (_fieldname, fileStream, info) => {
        const chunks: Buffer[] = [];
        let limitExceeded = false;
        const fileName = info.filename || "document.pdf";

        fileStream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        fileStream.on("limit", () => {
          limitExceeded = true;
        });

        const p = new Promise<void>((fileResolve) => {
          fileStream.on("end", () => {
            if (!limitExceeded && chunks.length > 0) {
              const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
              const stableBuf = Buffer.concat(chunks, totalLen);
              const stableBytes = createStableByteCopy(stableBuf);
              files.push({
                fileName,
                buffer: stableBuf,
                bytes: stableBytes,
                password: null,
              });
            }
            fileResolve();
          });
        });
        filePromises.push(p);
      });

      busboy.on("finish", async () => {
        await Promise.all(filePromises);
        // Apply global password to files that don't have individual passwords
        for (const f of files) {
          if (!f.password && globalPassword) {
            f.password = globalPassword;
          }
        }
        resolve({ files, globalPassword });
      });

      busboy.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Multipart parsing error";
        reject(new Error(`Failed to parse batch upload: ${msg}`));
      });

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

    // Case C: application/json
    if (contentType.includes("application/json")) {
      const reqAny = req as any;
      if (reqAny.body) {
        try {
          const data = typeof reqAny.body === "string" ? JSON.parse(reqAny.body) : reqAny.body;
          const globalPassword = data.password || null;
          const files: BatchUploadedFile[] = [];

          const rawFiles = Array.isArray(data.files)
            ? data.files
            : Array.isArray(data.filesBase64)
            ? data.filesBase64
            : data.fileBase64
            ? [{ fileName: data.fileName || "document.pdf", fileBase64: data.fileBase64, password: data.password }]
            : [];

          for (const item of rawFiles) {
            const b64 = typeof item === "string" ? item : item.fileBase64 || item.base64;
            if (b64) {
              const cleanB64 = b64.replace(/^data:[^;]+;base64,/, "");
              const buf = Buffer.from(cleanB64, "base64");
              const bytes = createStableByteCopy(buf);
              files.push({
                fileName: (item && item.fileName) || "document.pdf",
                buffer: buf,
                bytes,
                password: (item && item.password) || globalPassword,
              });
            }
          }

          resolve({ files, globalPassword });
          return;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Invalid JSON";
          reject(new Error(`Failed to parse batch JSON: ${msg}`));
          return;
        }
      }

      const chunks: Buffer[] = [];
      let totalLength = 0;

      req.on("data", (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > MAX_PDF_SIZE_BYTES * 5) {
          reject(new Error("Payload exceeds batch size limit."));
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        try {
          const bodyStr = Buffer.concat(chunks).toString("utf-8");
          const data = JSON.parse(bodyStr);
          const globalPassword = data.password || null;
          const files: BatchUploadedFile[] = [];

          const rawFiles = Array.isArray(data.files)
            ? data.files
            : Array.isArray(data.filesBase64)
            ? data.filesBase64
            : data.fileBase64
            ? [{ fileName: data.fileName || "document.pdf", fileBase64: data.fileBase64, password: data.password }]
            : [];

          for (const item of rawFiles) {
            const b64 = typeof item === "string" ? item : item.fileBase64 || item.base64;
            if (b64) {
              const cleanB64 = b64.replace(/^data:[^;]+;base64,/, "");
              const buf = Buffer.from(cleanB64, "base64");
              const bytes = createStableByteCopy(buf);
              files.push({
                fileName: (item && item.fileName) || "document.pdf",
                buffer: buf,
                bytes,
                password: (item && item.password) || globalPassword,
              });
            }
          }

          resolve({ files, globalPassword });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Invalid JSON";
          reject(new Error(`Failed to parse batch JSON: ${msg}`));
        }
      });

      req.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Stream read error";
        reject(new Error(`Batch stream error: ${msg}`));
      });
      return;
    }

    // Unsupported
    reject(new Error(`Unsupported content type: ${contentType}. Please use multipart/form-data or application/json.`));
  });
}

/**
 * Main API Handler for Batch PDF Processing.
 * Routes:
 * - POST /api/batches: Upload and process a batch of PDFs
 * - GET  /api/batches/:id: Retrieve full batch details and documents
 * - GET  /api/batches/:id/status: Lightweight polling endpoint for batch status
 * - POST /api/batches/:id/cancel: Cancel active batch
 */
export default async function batchesHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");

  // 1. Authenticate user for all batch operations
  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname.replace(/\/+/g, "/");
  const isAdmin = authUser.role === Role.ADMIN;

  // Extract batchId if present in route (/api/batches/:id or /api/batches/:id/status or /api/batches/:id/cancel)
  const batchPrefix = "/api/batches";
  let subPath = "";
  if (pathname.startsWith(batchPrefix)) {
    subPath = pathname.slice(batchPrefix.length).replace(/^\/+/, "");
  }
  const segments = subPath.split("/").filter(Boolean);
  const routeBatchId = segments[0] || null;
  const routeAction = segments[1] || null;

  try {
    // -------------------------------------------------------------
    // Route 1: POST /api/batches/:id/cancel
    // -------------------------------------------------------------
    if (routeBatchId && routeAction === "cancel" && req.method === "POST") {
      const batch = await prisma.processingBatch.findUnique({
        where: { id: routeBatchId },
      });

      if (!batch) {
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false, error: "Batch not found." }));
        return;
      }

      if (!isAdmin && batch.userId !== authUser.id) {
        res.statusCode = 403;
        res.end(JSON.stringify({ success: false, error: "Access denied. You do not own this batch." }));
        return;
      }

      activeCancelledBatches.add(routeBatchId);

      const updated = await prisma.processingBatch.update({
        where: { id: routeBatchId },
        data: {
          status: BatchStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      await logAuditEvent({
        userId: authUser.id,
        action: "BATCH_CANCELLED",
        entityType: "BATCH",
        entityId: routeBatchId,
      }).catch(() => null);

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          message: "Batch processing cancelled successfully.",
          batchId: updated.id,
          status: updated.status,
        })
      );
      return;
    }

    // -------------------------------------------------------------
    // Route 2: GET /api/batches/:id/status (Lightweight Polling)
    // -------------------------------------------------------------
    if (routeBatchId && routeAction === "status" && req.method === "GET") {
      const batch = await prisma.processingBatch.findUnique({
        where: { id: routeBatchId },
        select: {
          id: true,
          userId: true,
          status: true,
          totalDocuments: true,
          completedDocuments: true,
          failedDocuments: true,
          createdAt: true,
          completedAt: true,
        },
      });

      if (!batch) {
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false, error: "Batch not found." }));
        return;
      }

      if (!isAdmin && batch.userId !== authUser.id) {
        res.statusCode = 403;
        res.end(JSON.stringify({ success: false, error: "Access denied. You do not own this batch." }));
        return;
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          batchId: batch.id,
          status: batch.status,
          totalDocuments: batch.totalDocuments,
          completedDocuments: batch.completedDocuments,
          failedDocuments: batch.failedDocuments,
          createdAt: batch.createdAt,
          completedAt: batch.completedAt,
        })
      );
      return;
    }

    // -------------------------------------------------------------
    // Route 3: GET /api/batches/:id (Full Batch Details)
    // -------------------------------------------------------------
    if (routeBatchId && !routeAction && req.method === "GET") {
      const batch = await prisma.processingBatch.findUnique({
        where: { id: routeBatchId },
        include: {
          documents: {
            where: { deletedAt: null },
            include: {
              metadata: true,
              statement: {
                include: {
                  transactions: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!batch) {
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false, error: "Batch not found." }));
        return;
      }

      if (!isAdmin && batch.userId !== authUser.id) {
        res.statusCode = 403;
        res.end(JSON.stringify({ success: false, error: "Access denied. You do not own this batch." }));
        return;
      }

      const formattedDocuments = batch.documents.map((doc) => {
        const bank = normalizeBankCode(doc.statement?.bankName);
        const transactionCount = doc.statement?.transactions?.length ?? 0;
        return {
          id: doc.id,
          documentId: doc.id,
          fileName: doc.originalFileName,
          fileSize: doc.fileSize,
          status: doc.status,
          bank,
          transactionCount,
          createdAt: doc.createdAt,
        };
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          batch: {
            id: batch.id,
            status: batch.status,
            totalDocuments: batch.totalDocuments,
            completedDocuments: batch.completedDocuments,
            failedDocuments: batch.failedDocuments,
            createdAt: batch.createdAt,
            completedAt: batch.completedAt,
            documents: formattedDocuments,
          },
        })
      );
      return;
    }

    // -------------------------------------------------------------
    // Route 4: POST /api/batches (Batch Upload & Process)
    // -------------------------------------------------------------
    if ((pathname === "/api/batches" || pathname === "/api/batches/") && req.method === "POST") {
      let parsedPayload: { files: BatchUploadedFile[]; globalPassword?: string | null };
      try {
        parsedPayload = await parseBatchRequest(req);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to parse request";
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: msg }));
        return;
      }

      const { files, globalPassword } = parsedPayload;
      if (!files || files.length === 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: "No files uploaded for batch processing." }));
        return;
      }

      // 1. Create ProcessingBatch record
      const batchRecord = await prisma.processingBatch.create({
        data: {
          userId: authUser.id,
          status: BatchStatus.PROCESSING,
          totalDocuments: files.length,
          completedDocuments: 0,
          failedDocuments: 0,
        },
      });

      const batchId = batchRecord.id;

      // 2. Process documents through concurrency queue (limit = 2)
      const CONCURRENCY_LIMIT = 2;
      const results = await runWithConcurrency<BatchUploadedFile, BatchItemResult>(
        files,
        CONCURRENCY_LIMIT,
        async (fileItem, _idx) => {
          // Check cancellation check point 1
          if (activeCancelledBatches.has(batchId)) {
            return {
              documentId: null,
              fileName: fileItem.fileName,
              fileSize: fileItem.buffer.length,
              status: "CANCELLED",
              progress: 0,
              error: "Batch was cancelled by user.",
              bank: null,
              transactionCount: 0,
            };
          }

          const rawBuffer = fileItem.buffer;
          const fileName = fileItem.fileName || "statement.pdf";
          const password = fileItem.password || globalPassword || null;

          // Validate PDF integrity & size
          if (!rawBuffer || rawBuffer.length === 0 || !isPdfBuffer(rawBuffer)) {
            return {
              documentId: null,
              fileName,
              fileSize: rawBuffer ? rawBuffer.length : 0,
              status: "FAILED",
              progress: 0,
              error: "The file is not a valid PDF or has 0 bytes.",
              bank: null,
              transactionCount: 0,
            };
          }

          if (rawBuffer.length > MAX_PDF_SIZE_BYTES) {
            return {
              documentId: null,
              fileName,
              fileSize: rawBuffer.length,
              status: "FAILED",
              progress: 0,
              error: "File size exceeds 20 MB limit.",
              bank: null,
              transactionCount: 0,
            };
          }

          try {
            // Check for duplicates scoped to this user
            const fileHash = calculateFileHash(rawBuffer);
            const existing = await findDuplicateDocument(fileHash, authUser.id);

            if (existing) {
              // Update batchId on duplicate document
              await prisma.document.update({
                where: { id: existing.document.id },
                data: { batchId },
              }).catch(() => null);

              const docWithDetails = await prisma.document.findUnique({
                where: { id: existing.document.id },
                include: {
                  statement: {
                    include: { transactions: true },
                  },
                },
              });

              const bank = normalizeBankCode(docWithDetails?.statement?.bankName) || "BCA";
              const txCount = docWithDetails?.statement?.transactions?.length ?? 0;

              return {
                documentId: existing.document.id,
                fileName,
                fileSize: existing.document.fileSize,
                status: "COMPLETED",
                progress: 100,
                error: null,
                bank,
                transactionCount: txCount,
                isDuplicate: true,
              };
            }

            // Check cancellation check point 2
            if (activeCancelledBatches.has(batchId)) {
              return {
                documentId: null,
                fileName,
                fileSize: rawBuffer.length,
                status: "CANCELLED",
                progress: 0,
                error: "Batch was cancelled by user.",
                bank: null,
                transactionCount: 0,
              };
            }

            // Encryption detection and optional password decryption
            let workingBuffer = createStableBufferCopy(rawBuffer);
            let workingBytes = new Uint8Array(workingBuffer.buffer, workingBuffer.byteOffset, workingBuffer.byteLength);
            let wasEncrypted = false;

            const encDetection = await detectEncryption(workingBuffer);
            if (
              encDetection.securityState === "PASSWORD_REQUIRED" ||
              encDetection.securityState === "PASSWORD_PROTECTED"
            ) {
              if (!password || password.trim().length === 0) {
                return {
                  documentId: null,
                  fileName,
                  fileSize: rawBuffer.length,
                  status: "PASSWORD_REQUIRED",
                  progress: 0,
                  error: "Password PDF diperlukan untuk membuka dokumen ini.",
                  bank: null,
                  transactionCount: 0,
                };
              }

              const decRes = await decryptPdf(workingBuffer, password);
              if (!decRes.success || !decRes.decryptedBuffer) {
                return {
                  documentId: null,
                  fileName,
                  fileSize: rawBuffer.length,
                  status: "FAILED",
                  progress: 0,
                  error: decRes.error || "Password PDF salah atau dokumen tidak dapat dibuka.",
                  bank: null,
                  transactionCount: 0,
                };
              }

              workingBuffer = decRes.decryptedBuffer;
              workingBytes =
                decRes.decryptedBytes ||
                new Uint8Array(workingBuffer.buffer, workingBuffer.byteOffset, workingBuffer.byteLength);
              wasEncrypted = true;
            }

            // Inspect metadata
            const extractedMetadata = await inspectPdfMetadata(workingBytes);

            // Persist document to storage & DB
            const saved = await processAndSaveDocument({
              originalFileName: fileName,
              fileSize: rawBuffer.length,
              buffer: workingBuffer,
              extractedMetadata,
              userId: authUser.id,
              batchId,
            });

            const docId = saved.document.id;

            // Cache decrypted buffer for downstream engines
            if (wasEncrypted) {
              storeDecryptedBuffer(docId, workingBuffer, {
                fileHash: extractedMetadata.fileHash,
                wasEncrypted: true,
              });
            }

            // Check cancellation check point 3
            if (activeCancelledBatches.has(batchId)) {
              return {
                documentId: docId,
                fileName,
                fileSize: rawBuffer.length,
                status: "CANCELLED",
                progress: 0,
                error: "Batch was cancelled by user.",
                bank: null,
                transactionCount: 0,
              };
            }

            // Run Bank Detection
            let detectedBank: string | null = null;
            let isBankStatement = false;
            try {
              const bankRes = await runBankDetectionOnDocument(docId, workingBuffer, password || undefined);
              detectedBank =
                bankRes.detection?.bankCode ||
                normalizeBankCode(bankRes.statement?.bankName) ||
                bankRes.detection?.bankName ||
                null;
              isBankStatement = bankRes.detection?.documentType === "BANK_STATEMENT";
            } catch {
              // Non-critical, continue
            }

            // Run Transaction Extraction if statement detected
            let transactionCount = 0;
            let needsReview = false;
            if (isBankStatement || detectedBank) {
              try {
                const txRes = await runTransactionExtractionOnDocument(
                  docId,
                  workingBuffer,
                  password || undefined
                );
                transactionCount = txRes.transactions?.length ?? 0;
                if (txRes.reviewRows && txRes.reviewRows.length > 0) {
                  needsReview = true;
                }
              } catch {
                // If extraction failed, still report document
              }
            }

            return {
              documentId: docId,
              fileName,
              fileSize: rawBuffer.length,
              status: needsReview ? "NEEDS_REVIEW" : "COMPLETED",
              progress: 100,
              error: null,
              bank: detectedBank,
              transactionCount,
              isDuplicate: false,
            };
          } catch (fileErr: unknown) {
            const errMessage = sanitizeClientErrorMessage(
              fileErr instanceof Error ? fileErr.message : "Document processing failed"
            );
            return {
              documentId: null,
              fileName,
              fileSize: rawBuffer.length,
              status: "FAILED",
              progress: 0,
              error: errMessage,
              bank: null,
              transactionCount: 0,
            };
          }
        }
      );

      // Clean up in-memory cancellation tracking
      const wasCancelled = activeCancelledBatches.has(batchId);
      activeCancelledBatches.delete(batchId);

      const completedCount = results.filter(
        (r) => r.status === "COMPLETED" || r.status === "NEEDS_REVIEW"
      ).length;
      const failedCount = results.filter(
        (r) => r.status === "FAILED" || r.status === "PASSWORD_REQUIRED"
      ).length;
      const needsReviewCount = results.filter((r) => r.status === "NEEDS_REVIEW").length;

      let finalBatchStatus: BatchStatus = BatchStatus.COMPLETED;
      if (wasCancelled) {
        finalBatchStatus = BatchStatus.CANCELLED;
      } else if (failedCount === results.length) {
        finalBatchStatus = BatchStatus.FAILED;
      } else if (failedCount > 0) {
        finalBatchStatus = BatchStatus.PARTIAL;
      }

      await prisma.processingBatch.update({
        where: { id: batchId },
        data: {
          status: finalBatchStatus,
          completedDocuments: completedCount,
          failedDocuments: failedCount,
          completedAt: new Date(),
        },
      });

      await logAuditEvent({
        userId: authUser.id,
        action: "BATCH_PROCESSED",
        entityType: "BATCH",
        entityId: batchId,
        metadata: {
          total: results.length,
          completed: completedCount,
          failed: failedCount,
          status: finalBatchStatus,
        },
      }).catch(() => null);

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          batchId,
          status: finalBatchStatus,
          summary: {
            total: results.length,
            completed: completedCount,
            processing: 0,
            failed: failedCount,
            needsReview: needsReviewCount,
          },
          documents: results,
        })
      );
      return;
    }

    // Unmatched sub-route
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: "Batch route not found." }));
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : "Internal batch processing error";
    const sanitized = sanitizeClientErrorMessage(rawMsg);
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: sanitized }));
  }
}
