import type { IncomingMessage, ServerResponse } from "http";
import { Readable } from "stream";
import Busboy from "busboy";
import {
  inspectPdfMetadata,
  createStableByteCopy,
  createStableBufferCopy,
  calculateFileHash,
  MAX_PDF_SIZE_BYTES,
} from "../../lib/pdf/pdf-inspector.js";
import {
  detectEncryption,
  decryptPdf,
  storeDecryptedBuffer,
  createProcessedPdf,
  type ProcessedPdf,
  type DecryptPdfResult,
} from "../../lib/pdf/pdf-decryptor.js";
import {
  processAndSaveDocument,
  runBankDetectionOnDocument,
  runTransactionExtractionOnDocument,
} from "../../lib/db/documents.js";
import { requireAuth, logAuditEvent } from "../../lib/auth/index.js";
import { assertStorageConfigured } from "../../lib/storage/index.js";
import {
  normalizeAnalysisOptions,
  type AnalysisFeature,
} from "../../lib/analysis/feature-pipeline.js";

interface ParsedUpload {
  fileName: string;
  bytes: Uint8Array;
  buffer: Buffer;
  password?: string | null;
  features?: string | string[] | null;
}

/**
 * Parses an incoming HTTP request for uploaded PDF data and optional PDF password.
 * Supports web request.formData(), Node multipart/form-data, and application/json (base64).
 * Creates a stable, independent byte representation immediately upon receiving file bytes.
 */
async function parseRequestPayload(req: IncomingMessage): Promise<ParsedUpload> {
  // Case A: Web Standard Request or framework with req.formData()
  if (typeof (req as unknown as { formData?: () => Promise<FormData> }).formData === "function") {
    try {
      const formData = await (req as unknown as { formData: () => Promise<FormData> }).formData();
      const fileItem = formData.get("file") || formData.get("pdf") || formData.get("document");
      const password = (formData.get("password") as string) || null;
      const featuresRaw = (formData.get("features") as string) || null;
      if (fileItem && typeof (fileItem as Blob).arrayBuffer === "function") {
        const file = fileItem as File;
        const sourceArrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(sourceArrayBuffer.slice(0));
        const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const fileName = (file as { name?: string }).name || "document.pdf";
        return { fileName, bytes, buffer, password, features: featuresRaw };
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
      let password: string | null = null;
      let features: string | null = null;
      const chunks: Buffer[] = [];
      let limitExceeded = false;

      busboy.on("field", (fieldname, val) => {
        if (fieldname === "password") {
          password = val;
        } else if (fieldname === "features") {
          features = val;
        }
      });

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
        resolve({ fileName: originalFileName, bytes: stableBytes, buffer: stableBuffer, password, features });
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
          const password = data.password || null;
          const features = data.features || null;
          resolve({ fileName, bytes: stableBytes, buffer: stableBuffer, password, features });
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
    console.log("[PDF_PIPELINE] original PDF received");

    // 1. Parse and extract uploaded file & optional password
    const { fileName, buffer, bytes, password, features } = await parseRequestPayload(req);
    const selectedFeatures = normalizeAnalysisOptions(features);
    const runMetadata = selectedFeatures.includes("metadata");
    const runBankDetection = selectedFeatures.includes("bankDetection");
    const runTransactionExtraction = selectedFeatures.includes("transactionExtraction");
    const runValidation = selectedFeatures.includes("validation");
    const runExcelExport = selectedFeatures.includes("excelExport");

    console.log("[PDF_INSPECT] file bytes loaded");
    console.log("[PDF_INSPECT] stable byte copy created");
    console.log("[PDF_PIPELINE] execution plan:", selectedFeatures.join(", "));

    // 2. Encryption Detection
    const encryptionDetection = await detectEncryption(bytes || buffer);

    if (encryptionDetection.securityState === "INVALID_PDF") {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          securityState: "INVALID_PDF",
          error: encryptionDetection.errorMessage || "Invalid file signature: The file is not a valid PDF (missing %PDF- header).",
        })
      );
      return;
    }

    if (encryptionDetection.securityState === "UNSUPPORTED_ENCRYPTION") {
      res.statusCode = 422;
      res.end(
        JSON.stringify({
          success: false,
          securityState: "UNSUPPORTED_ENCRYPTION",
          error: "Jenis enkripsi PDF ini belum didukung.",
          algorithm: encryptionDetection.algorithm || "UNKNOWN",
        })
      );
      return;
    }

    let isEncryptedDoc = false;
    let decryptResult: DecryptPdfResult | null = null;
    let processedPdf: ProcessedPdf;

    if (encryptionDetection.securityState === "PASSWORD_PROTECTED") {
      isEncryptedDoc = true;
      console.log("[PDF_PIPELINE] encrypted PDF detected");

      // If user has not yet supplied a password, prompt for it
      if (!password || password.trim().length === 0) {
        res.statusCode = 422;
        res.end(
          JSON.stringify({
            success: false,
            requiresPassword: true,
            securityState: "PASSWORD_PROTECTED",
            message: "Dokumen ini dilindungi password. Masukkan password PDF untuk melanjutkan analisis.",
            algorithm: encryptionDetection.algorithm,
          })
        );
        return;
      }

      // Decrypt PDF in-memory
      decryptResult = await decryptPdf(bytes || buffer, password);
      if (!decryptResult.success || !decryptResult.decryptedBytes) {
        res.statusCode = 422;
        res.end(
          JSON.stringify({
            success: false,
            requiresPassword: true,
            securityState: decryptResult.securityState,
            error: decryptResult.error || "Password PDF salah atau dokumen tidak dapat dibuka.",
            algorithm: decryptResult.algorithm,
          })
        );
        return;
      }

      // Canonical ProcessedPdf: encrypted PDF was decrypted
      processedPdf = createProcessedPdf(bytes, decryptResult.decryptedBytes, true);
    } else {
      // Canonical ProcessedPdf: unencrypted PDF
      processedPdf = createProcessedPdf(bytes, bytes, false);
    }

    // 3. Perform server-side metadata inspection and validation
    // Computes original file hash from the original uploaded file (encrypted)
    const originalFileHash = calculateFileHash(processedPdf.originalBytes);

    // Metadata inspection receives analysisBytes (decrypted bytes)
    console.log("[PDF_PIPELINE] metadata inspection input = decrypted bytes");
    const extractedMetadata = await inspectPdfMetadata(processedPdf.analysisBytes, {
      originalFileHash,
    });

    // Ensure original file hash remains associated with the uploaded document
    extractedMetadata.fileHash = originalFileHash;
    extractedMetadata.rawMetadataJson = {
      ...extractedMetadata.rawMetadataJson,
      originalFileHash,
      securityState: encryptionDetection.securityState,
      isEncrypted: isEncryptedDoc,
      encryptionAlgorithm: encryptionDetection.algorithm || null,
    };

    // 4. Process and persist document + metadata + processing job under authenticated user
    // The original encrypted PDF is saved to storage, NOT the decrypted copy!
    const result = await processAndSaveDocument({
      originalFileName: fileName,
      fileSize: buffer.length,
      buffer, // Original encrypted buffer
      extractedMetadata,
      userId: authUser.id,
    });

    // If document was encrypted and successfully decrypted, store in-memory buffer
    // indexed by documentId, storageKey, and fileHash so downstream operations can use it
    if (isEncryptedDoc) {
      storeDecryptedBuffer(result.document.id, Buffer.from(processedPdf.analysisBytes), {
        fileHash: originalFileHash,
        storageKey: result.document.storageKey,
        bytes: processedPdf.analysisBytes,
        wasEncrypted: true,
        extractedText: decryptResult?.extractedText,
      });
    }

    // 5. Run Bank Detection if selected
    let bankDetectionResult: Awaited<ReturnType<typeof runBankDetectionOnDocument>> | null = null;
    let bankDetectionStatus: "SUCCESS" | "FAILED" | "SKIPPED" = "SKIPPED";

    if (runBankDetection) {
      console.log("[PDF_PIPELINE] bank detection input = decrypted bytes");
      try {
        bankDetectionResult = await runBankDetectionOnDocument(
          result.document.id,
          Buffer.from(processedPdf.analysisBytes)
        );
        if (bankDetectionResult && bankDetectionResult.detection) {
          bankDetectionStatus = "SUCCESS";
        } else {
          bankDetectionStatus = "FAILED";
        }
      } catch (bankErr: unknown) {
        console.warn(
          "[PDF_PIPELINE] bank detection non-fatal error:",
          bankErr instanceof Error ? bankErr.message : "Bank detection error"
        );
        bankDetectionStatus = "FAILED";
      }
    } else {
      console.log("[PDF_PIPELINE] bank detection skipped by user selection");
    }

    // 6. Run Transaction Extraction if selected and classified as BANK_STATEMENT
    let txExtractionResult: Awaited<ReturnType<typeof runTransactionExtractionOnDocument>> | null = null;
    let txExtractionStatus: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED" = "SKIPPED";

    const isBankStatement =
      bankDetectionResult?.detection?.documentType === "BANK_STATEMENT" ||
      bankDetectionResult?.document?.documentType === "BANK_STATEMENT";

    if (runTransactionExtraction) {
      if (isBankStatement && !bankDetectionResult?.detection?.isScannedOrImageOnly) {
        console.log("[PDF_PIPELINE] transaction extraction input = decrypted bytes");
        try {
          txExtractionResult = await runTransactionExtractionOnDocument(
            result.document.id,
            Buffer.from(processedPdf.analysisBytes)
          );
          if (txExtractionResult) {
            txExtractionStatus =
              txExtractionResult.status === "COMPLETED"
                ? "SUCCESS"
                : txExtractionResult.status === "NEEDS_REVIEW"
                ? "PARTIAL"
                : "FAILED";
          } else {
            txExtractionStatus = "FAILED";
          }
        } catch (txErr: unknown) {
          console.warn(
            "[PDF_PIPELINE] transaction extraction non-fatal error:",
            txErr instanceof Error ? txErr.message : "Extraction error"
          );
          txExtractionStatus = "FAILED";
        }
      } else {
        txExtractionStatus = "FAILED";
      }
    } else {
      console.log("[PDF_PIPELINE] transaction extraction skipped by user selection");
    }

    // 6b. Validation Status
    let validationStatus: "SUCCESS" | "FAILED" | "SKIPPED" = "SKIPPED";
    if (runValidation) {
      if (txExtractionResult && txExtractionResult.validation) {
        validationStatus = "SUCCESS";
      } else if (runTransactionExtraction && txExtractionStatus === "FAILED") {
        validationStatus = "FAILED";
      }
    }

    // 6c. Excel Export Status
    let excelExportStatus: "SUCCESS" | "FAILED" | "SKIPPED" = "SKIPPED";
    if (runExcelExport) {
      if (txExtractionResult && txExtractionResult.transactions && txExtractionResult.transactions.length > 0) {
        excelExportStatus = "SUCCESS";
      } else if (runTransactionExtraction && txExtractionStatus === "FAILED") {
        excelExportStatus = "FAILED";
      }
    }

    // 7. Record audit event
    await logAuditEvent({
      userId: authUser.id,
      action: "DOCUMENT_UPLOADED",
      entityType: "DOCUMENT",
      entityId: result.document.id,
      metadata: {
        fileName,
        fileSize: buffer.length,
        isDuplicate: result.isDuplicate,
        isEncrypted: isEncryptedDoc,
        securityState: encryptionDetection.securityState,
        bankDetected: bankDetectionResult?.statement?.bankName || null,
        transactionCount: txExtractionResult?.transactions?.length ?? 0,
        executionPlan: selectedFeatures,
      },
    });

    // 8. Deliver unified response with independent engine results (Instruction 8 & 9)
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        isDuplicate: result.isDuplicate,
        securityState: encryptionDetection.securityState,
        isEncrypted: isEncryptedDoc,
        executionPlan: selectedFeatures,
        message: result.isDuplicate
          ? "This PDF has already been analyzed."
          : "PDF metadata successfully extracted and saved.",
        engineResults: {
          metadata: {
            status: runMetadata ? extractedMetadata.metadataStatus : "SKIPPED",
            pageCount: runMetadata ? extractedMetadata.pageCount : null,
          },
          bankDetection: {
            status: bankDetectionStatus,
            bank: bankDetectionResult?.detection?.bankCode || null,
            bankName: bankDetectionResult?.statement?.bankName || bankDetectionResult?.detection?.bankName || null,
          },
          transactionExtraction: {
            status: txExtractionStatus,
            transactionCount: txExtractionResult?.transactions?.length ?? 0,
            needsReview: txExtractionResult?.reviewRows?.length ?? 0,
          },
          validation: {
            status: validationStatus,
            balanceReconciliationStatus: txExtractionResult?.summary?.balanceReconciliationStatus || null,
          },
          excelExport: {
            status: excelExportStatus,
          },
        },
        data: {
          document: bankDetectionResult?.document
            ? { ...result.document, ...bankDetectionResult.document }
            : result.document,
          metadata: runMetadata ? result.metadata : null,
          job: result.job,
          detection: bankDetectionResult?.detection ?? null,
          statement: bankDetectionResult?.statement ?? null,
          extraction: txExtractionResult ?? null,
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
        .replace(/password[:=][^\s&]+/gi, "password=***")
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
