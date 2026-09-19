import { prisma } from "./prisma";
import type { ExtractedPdfMetadata } from "../pdf/pdf-inspector";
import { extractPdfText } from "../pdf/pdf-text-extractor";
import { defaultBankDetectionEngine, type BankDetectionResult } from "../bank-detection";
import {
  defaultTransactionExtractionEngine,
  type ParsedTransaction,
  type ReviewRow,
  type TransactionExtractionValidation,
  type ExtractionStatus,
} from "../transaction-extraction";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Prisma, type DocumentType } from "@prisma/client";
import {
  getStorageProvider,
  generateStorageKey,
  getDocumentPdf,
  isPdfBuffer,
} from "../storage";

export { getDocumentPdf };

const SYSTEM_USER_EMAIL = "system@metadata-checker.local";

// In-memory buffer cache for rapid retrieval without extra disk or network round-trips
const documentBufferCache = new Map<string, Buffer>();

/**
 * Saves a document's binary buffer into the active StorageProvider and cache.
 */
export function persistBuffer(documentId: string, storageKey: string, buffer: Buffer): void {
  documentBufferCache.set(documentId, buffer);
  documentBufferCache.set(storageKey, buffer);

  const provider = getStorageProvider();
  provider.upload(storageKey, buffer, { contentType: "application/pdf" }).catch(() => null);
}

/**
 * Retrieves the stored binary buffer for a given document.
 */
export async function getDocumentBuffer(documentId: string): Promise<Buffer | null> {
  if (documentBufferCache.has(documentId)) {
    return documentBufferCache.get(documentId)!;
  }

  try {
    const { buffer } = await getDocumentPdf(documentId);
    documentBufferCache.set(documentId, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Ensures a default system user exists in the database.
 * This satisfies foreign key constraints before explicit authentication is implemented.
 */
export async function getOrCreateSystemUser() {
  return await prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {},
    create: {
      email: SYSTEM_USER_EMAIL,
      name: "System User",
      role: "USER",
    },
  });
}

/**
 * Checks if a file with the given SHA-256 hash has already been processed.
 * If found, returns the existing document and its metadata.
 */
export async function findDuplicateDocument(fileHash: string) {
  const existingMetadata = await prisma.documentMetadata.findFirst({
    where: { fileHash },
    include: {
      document: true,
    },
  });

  if (!existingMetadata) {
    return null;
  }

  return {
    document: existingMetadata.document,
    metadata: existingMetadata,
  };
}

export interface SaveDocumentOptions {
  originalFileName: string;
  fileSize: number;
  buffer: Buffer;
  extractedMetadata: ExtractedPdfMetadata;
}

export interface SaveDocumentResult {
  isDuplicate: boolean;
  document: {
    id: string;
    originalFileName: string;
    storedFileName: string;
    mimeType: string;
    fileSize: number;
    status: string;
    documentType: string;
    createdAt: Date;
    updatedAt: Date;
  };
  metadata: {
    id: string;
    documentId: string;
    title: string | null;
    author: string | null;
    subject: string | null;
    creator: string | null;
    producer: string | null;
    creationDate: Date | null;
    modificationDate: Date | null;
    pageCount: number | null;
    fileHash: string | null;
    rawMetadataJson: unknown;
  };
  job?: {
    id: string;
    jobType: string;
    status: string;
    errorMessage: string | null;
  };
}

/**
 * Core workflow to persist a document, execute processing job tracking,
 * and save extracted PDF metadata.
 */
export async function processAndSaveDocument(
  options: SaveDocumentOptions
): Promise<SaveDocumentResult> {
  const { originalFileName, fileSize, extractedMetadata } = options;
  const { fileHash } = extractedMetadata;

  // 1. Check for duplicates using SHA-256
  const existing = await findDuplicateDocument(fileHash);
  if (existing) {
    const provider = getStorageProvider();
    const exists = await provider.exists(existing.document.storageKey).catch(() => false);
    if (!exists) {
      await provider
        .upload(existing.document.storageKey, options.buffer, {
          contentType: "application/pdf",
        })
        .catch(() => null);
    }
    documentBufferCache.set(existing.document.id, options.buffer);
    documentBufferCache.set(existing.document.storageKey, options.buffer);

    return {
      isDuplicate: true,
      document: existing.document,
      metadata: existing.metadata,
    };
  }

  // 2. Ensure system user exists
  const user = await getOrCreateSystemUser();

  // 3. Generate unique document ID and canonical storage key
  const documentId = crypto.randomUUID();
  const { storageKey, storedFileName } = generateStorageKey(documentId, originalFileName);

  // 4. Upload PDF to StorageProvider before database insertion
  const provider = getStorageProvider();
  await provider.upload(storageKey, options.buffer, {
    contentType: "application/pdf",
  });

  // Keep cache populated for fast immediate access
  documentBufferCache.set(documentId, options.buffer);
  documentBufferCache.set(storageKey, options.buffer);

  // 5. Create Document record with initial UPLOADED status
  const document = await prisma.document.create({
    data: {
      id: documentId,
      userId: user.id,
      originalFileName,
      storedFileName,
      mimeType: "application/pdf",
      fileSize,
      storageKey,
      status: "UPLOADED",
      documentType: "UNKNOWN",
    },
  });

  // 5. Create ProcessingJob (Initial status: QUEUED -> PROCESSING)
  const job = await prisma.processingJob.create({
    data: {
      documentId: document.id,
      jobType: "METADATA_EXTRACTION",
      status: "PROCESSING",
      startedAt: new Date(),
    },
  });

  try {
    // 6. Save DocumentMetadata
    const metadata = await prisma.documentMetadata.create({
      data: {
        documentId: document.id,
        title: extractedMetadata.title,
        author: extractedMetadata.author,
        subject: extractedMetadata.subject,
        creator: extractedMetadata.creator,
        producer: extractedMetadata.producer,
        creationDate: extractedMetadata.creationDate,
        modificationDate: extractedMetadata.modificationDate,
        pageCount: extractedMetadata.pageCount,
        fileHash: extractedMetadata.fileHash,
        rawMetadataJson: extractedMetadata.rawMetadataJson as Prisma.InputJsonValue,
      },
    });

    // 7. Update Document status to COMPLETED
    const updatedDocument = await prisma.document.update({
      where: { id: document.id },
      data: {
        status: "COMPLETED",
      },
    });

    // 8. Update ProcessingJob to COMPLETED
    const completedJob = await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return {
      isDuplicate: false,
      document: updatedDocument,
      metadata,
      job: completedJob,
    };
  } catch (error: unknown) {
    const rawError = error instanceof Error ? error.message : "Database persistence error";
    // Sanitize error message to avoid leaking internal details
    const sanitizedError = rawError
      .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
      .slice(0, 255);

    // Update Document & ProcessingJob to FAILED
    await prisma.document.update({
      where: { id: document.id },
      data: { status: "FAILED" },
    }).catch(() => null);

    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: sanitizedError,
        completedAt: new Date(),
      },
    }).catch(() => null);

    throw new Error(`Failed to save metadata to database: ${sanitizedError}`);
  }
}

export interface BankDetectionWorkflowResult {
  document: {
    id: string;
    originalFileName: string;
    status: string;
    documentType: string;
  };
  detection: BankDetectionResult;
  bankAccount?: {
    id: string;
    bankName: string;
    accountNumberMasked: string;
    accountHolderName: string;
  } | null;
  statement?: {
    id: string;
    bankName: string;
    accountNumberMasked: string | null;
    accountHolderName: string | null;
    statementPeriodStart: Date | null;
    statementPeriodEnd: Date | null;
  } | null;
  job: {
    id: string;
    jobType: string;
    status: string;
    errorMessage: string | null;
  };
}

/**
 * Executes the server-side Bank Statement Detection Engine for an existing document.
 * Retrieves the stored PDF, extracts text, identifies the bank and statement attributes,
 * updates Document, BankAccount, and Statement records, and logs a BANK_DETECTION ProcessingJob.
 */
export async function runBankDetectionOnDocument(
  documentId: string,
  directBuffer?: Buffer
): Promise<BankDetectionWorkflowResult> {
  // 1. Fetch document and existing metadata
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      metadata: true,
      statement: true,
    },
  });

  if (!document) {
    throw new Error("Document not found");
  }

  // 2. Retrieve document buffer via canonical getDocumentPdf
  let buffer: Buffer;
  if (directBuffer && isPdfBuffer(directBuffer)) {
    buffer = directBuffer;
  } else {
    const retrieved = await getDocumentPdf(documentId);
    buffer = retrieved.buffer;
  }

  // 3. Create BANK_DETECTION ProcessingJob (QUEUED -> PROCESSING)
  const job = await prisma.processingJob.create({
    data: {
      documentId: document.id,
      jobType: "BANK_DETECTION",
      status: "PROCESSING",
      startedAt: new Date(),
    },
  });

  try {
    // 4. Extract PDF text per page
    const textResult = await extractPdfText(buffer);

    // 5. Run detection engine
    const metadata = document.metadata
      ? {
          title: document.metadata.title,
          author: document.metadata.author,
          creator: document.metadata.creator,
          producer: document.metadata.producer,
          subject: document.metadata.subject,
        }
      : undefined;

    const detection = defaultBankDetectionEngine.detect(textResult, metadata);

    // 6. Map classification to Prisma DocumentType enum
    let docTypeEnum: DocumentType = "UNKNOWN";
    if (detection.documentType === "BANK_STATEMENT") {
      docTypeEnum = "BANK_STATEMENT";
    } else if (detection.documentType === "OTHER_PDF") {
      docTypeEnum = "OTHER_PDF";
    }

    // 7. Update Document.documentType
    const updatedDocument = await prisma.document.update({
      where: { id: document.id },
      data: {
        documentType: docTypeEnum,
      },
    });

    // 8. Create or find BankAccount if account details detected
    let bankAccount: {
      id: string;
      bankName: string;
      accountNumberMasked: string;
      accountHolderName: string;
    } | null = null;

    if (detection.bankName && detection.accountNumberMasked) {
      const existingAccount = await prisma.bankAccount.findFirst({
        where: {
          userId: document.userId,
          accountNumberMasked: detection.accountNumberMasked,
        },
      });

      if (existingAccount) {
        bankAccount = existingAccount;
      } else {
        bankAccount = await prisma.bankAccount.create({
          data: {
            userId: document.userId,
            bankName: detection.bankName,
            accountNumberMasked: detection.accountNumberMasked,
            accountHolderName: detection.accountHolderName || "Account Holder",
          },
        });
      }
    }

    // 9. Create or update Statement record if bank statement detected or period found
    let statementRecord: {
      id: string;
      bankName: string;
      accountNumberMasked: string | null;
      accountHolderName: string | null;
      statementPeriodStart: Date | null;
      statementPeriodEnd: Date | null;
    } | null = null;

    if (
      detection.documentType === "BANK_STATEMENT" ||
      detection.statementPeriodStart ||
      detection.statementPeriodEnd ||
      detection.accountNumberMasked
    ) {
      const pStart = detection.statementPeriodStart
        ? new Date(detection.statementPeriodStart)
        : null;
      const pEnd = detection.statementPeriodEnd
        ? new Date(detection.statementPeriodEnd)
        : null;

      statementRecord = await prisma.statement.upsert({
        where: { documentId: document.id },
        update: {
          bankAccountId: bankAccount?.id ?? null,
          bankName: detection.bankName || "Unknown Bank",
          accountNumberMasked: detection.accountNumberMasked,
          accountHolderName: detection.accountHolderName,
          statementPeriodStart: pStart,
          statementPeriodEnd: pEnd,
        },
        create: {
          documentId: document.id,
          bankAccountId: bankAccount?.id ?? null,
          bankName: detection.bankName || "Unknown Bank",
          accountNumberMasked: detection.accountNumberMasked,
          accountHolderName: detection.accountHolderName,
          statementPeriodStart: pStart,
          statementPeriodEnd: pEnd,
        },
      });
    }

    // 10. Update ProcessingJob to COMPLETED
    const completedJob = await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return {
      document: {
        id: updatedDocument.id,
        originalFileName: updatedDocument.originalFileName,
        status: updatedDocument.status,
        documentType: updatedDocument.documentType,
      },
      detection,
      bankAccount,
      statement: statementRecord,
      job: {
        id: completedJob.id,
        jobType: completedJob.jobType,
        status: completedJob.status,
        errorMessage: completedJob.errorMessage,
      },
    };
  } catch (err: unknown) {
    const rawError = err instanceof Error ? err.message : "Bank detection error";
    const sanitizedError = rawError
      .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
      .slice(0, 255);

    const failedJob = await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: sanitizedError,
        completedAt: new Date(),
      },
    }).catch(() => job);

    throw new Error(`Bank detection failed: ${sanitizedError}`);
  }
}

export interface TransactionExtractionWorkflowResult {
  documentId: string;
  statementId: string;
  status: ExtractionStatus;
  summary: {
    totalRowsDetected: number;
    totalTransactionsParsed: number;
    totalTransactionsRejected: number;
    totalTransactionsNeedingReview: number;
    totalCredit: string;
    totalDebit: string;
    openingBalance: string | null;
    closingBalance: string | null;
    balanceReconciliationStatus: string;
  };
  transactions: ParsedTransaction[];
  reviewRows: ReviewRow[];
  validation: TransactionExtractionValidation;
  warning?: string | null;
  job: {
    id: string;
    jobType: string;
    status: string;
    errorMessage: string | null;
  };
}

/**
 * Runs the Transaction Extraction Engine for an existing bank statement document.
 * Adheres strictly to security, idempotent replacement, Decimal(18,2) preservation,
 * and review row visibility.
 */
export async function runTransactionExtractionOnDocument(
  documentId: string,
  directBuffer?: Buffer
): Promise<TransactionExtractionWorkflowResult> {
  // 1. Verify document exists
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      metadata: true,
      statement: true,
      processingJobs: {
        where: { jobType: "BANK_DETECTION" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!document) {
    throw new Error("Document not found.");
  }

  // 2. Verify it is a BANK_STATEMENT
  if (document.documentType === "OTHER_PDF") {
    throw new Error("Document is classified as a non-financial PDF (OTHER_PDF).");
  }

  // 3. Verify bank detection has completed
  if (!document.statement && document.documentType !== "BANK_STATEMENT") {
    throw new Error("Bank detection has not been completed for this document.");
  }

  // 4. Create ProcessingJob (jobType: TRANSACTION_EXTRACTION, status: PROCESSING)
  const job = await prisma.processingJob.create({
    data: {
      documentId: document.id,
      jobType: "TRANSACTION_EXTRACTION",
      status: "PROCESSING",
      startedAt: new Date(),
    },
  });

  try {
    // 5. Retrieve PDF buffer via canonical getDocumentPdf
    let buffer: Buffer;
    if (directBuffer && isPdfBuffer(directBuffer)) {
      buffer = directBuffer;
    } else {
      const retrieved = await getDocumentPdf(documentId);
      buffer = retrieved.buffer;
    }

    // 6. Extract PDF text per page (preserves page boundaries)
    const textResult = await extractPdfText(buffer);

    // 7. Check if document is scanned / image-only
    if (textResult.isScannedOrImageOnly) {
      const scanWarning =
        "This PDF appears to be image-based and requires OCR before transactions can be extracted reliably.";

      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          errorMessage: scanWarning,
          completedAt: new Date(),
        },
      });

      return {
        documentId: document.id,
        statementId: document.statement?.id || "",
        status: "NEEDS_REVIEW",
        summary: {
          totalRowsDetected: 0,
          totalTransactionsParsed: 0,
          totalTransactionsRejected: 0,
          totalTransactionsNeedingReview: 0,
          totalCredit: "0.00",
          totalDebit: "0.00",
          openingBalance: null,
          closingBalance: null,
          balanceReconciliationStatus: "NEEDS_REVIEW",
        },
        transactions: [],
        reviewRows: [],
        validation: {
          totalRowsDetected: 0,
          totalTransactionsParsed: 0,
          totalTransactionsRejected: 0,
          totalTransactionsNeedingReview: 0,
          firstTransactionDate: null,
          lastTransactionDate: null,
          calculatedCredits: "0.00",
          calculatedDebits: "0.00",
          sourceOpeningBalance: null,
          sourceClosingBalance: null,
          balanceReconciliationStatus: "NEEDS_REVIEW",
          warnings: [scanWarning],
        },
        warning: scanWarning,
        job: {
          id: job.id,
          jobType: job.jobType,
          status: "COMPLETED",
          errorMessage: scanWarning,
        },
      };
    }

    // Ensure statement record exists
    let statementRecord = document.statement;
    if (!statementRecord) {
      statementRecord = await prisma.statement.create({
        data: {
          documentId: document.id,
          bankName: "Unknown Bank",
        },
      });
    }

    // 8. Run transaction extraction engine
    const periodStart = statementRecord.statementPeriodStart
      ? statementRecord.statementPeriodStart.toISOString().split("T")[0]
      : null;
    const periodEnd = statementRecord.statementPeriodEnd
      ? statementRecord.statementPeriodEnd.toISOString().split("T")[0]
      : null;

    const extractionResult = defaultTransactionExtractionEngine.extract({
      fullText: textResult.fullText,
      pages: textResult.pages,
      bankName: statementRecord.bankName,
      statementPeriodStart: periodStart,
      statementPeriodEnd: periodEnd,
      isScannedOrImageOnly: textResult.isScannedOrImageOnly,
      sourceOpeningBalance: statementRecord.openingBalance?.toString() || null,
      sourceClosingBalance: statementRecord.closingBalance?.toString() || null,
    });

    // 9. Persist transactions atomically with duplicate protection
    const transactionsToInsert = extractionResult.transactions;

    await prisma.$transaction(async (tx) => {
      // Delete existing transactions for this statement (idempotent replacement)
      await tx.transaction.deleteMany({
        where: { statementId: statementRecord.id },
      });

      // Insert extracted valid transactions
      if (transactionsToInsert.length > 0) {
        await tx.transaction.createMany({
          data: transactionsToInsert.map((t) => ({
            statementId: statementRecord.id,
            transactionDate: new Date(t.transactionDate),
            description: t.description,
            referenceNumber: t.referenceNumber,
            debit: t.debit ? new Prisma.Decimal(t.debit) : null,
            credit: t.credit ? new Prisma.Decimal(t.credit) : null,
            balance: new Prisma.Decimal(t.balance),
            transactionType: t.transactionType,
            category: t.category,
          })),
        });
      }

      // Update Statement record metadata and totals
      await tx.statement.update({
        where: { id: statementRecord.id },
        data: {
          transactionCount: transactionsToInsert.length,
          totalCredit: extractionResult.validation.calculatedCredits
            ? new Prisma.Decimal(extractionResult.validation.calculatedCredits)
            : null,
          totalDebit: extractionResult.validation.calculatedDebits
            ? new Prisma.Decimal(extractionResult.validation.calculatedDebits)
            : null,
          openingBalance: extractionResult.validation.sourceOpeningBalance
            ? new Prisma.Decimal(extractionResult.validation.sourceOpeningBalance)
            : undefined,
          closingBalance: extractionResult.validation.sourceClosingBalance
            ? new Prisma.Decimal(extractionResult.validation.sourceClosingBalance)
            : undefined,
        },
      });
    });

    // 10. Update ProcessingJob to COMPLETED
    const completedJob = await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return {
      documentId: document.id,
      statementId: statementRecord.id,
      status: extractionResult.status,
      summary: {
        totalRowsDetected: extractionResult.validation.totalRowsDetected,
        totalTransactionsParsed: extractionResult.validation.totalTransactionsParsed,
        totalTransactionsRejected: extractionResult.validation.totalTransactionsRejected,
        totalTransactionsNeedingReview: extractionResult.validation.totalTransactionsNeedingReview,
        totalCredit: extractionResult.validation.calculatedCredits,
        totalDebit: extractionResult.validation.calculatedDebits,
        openingBalance: extractionResult.validation.sourceOpeningBalance,
        closingBalance: extractionResult.validation.sourceClosingBalance,
        balanceReconciliationStatus: extractionResult.validation.balanceReconciliationStatus,
      },
      transactions: extractionResult.transactions,
      reviewRows: extractionResult.reviewRows,
      validation: extractionResult.validation,
      warning: extractionResult.warning,
      job: {
        id: completedJob.id,
        jobType: completedJob.jobType,
        status: completedJob.status,
        errorMessage: completedJob.errorMessage,
      },
    };
  } catch (err: unknown) {
    const rawError = err instanceof Error ? err.message : "Transaction extraction error";
    const sanitizedError = rawError
      .replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@")
      .slice(0, 255);

    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: sanitizedError,
        completedAt: new Date(),
      },
    }).catch(() => job);

    throw new Error(`Transaction extraction failed: ${sanitizedError}`);
  }
}

/**
 * Retrieves persisted transactions for a given document.
 */
export async function getTransactionsForDocument(documentId: string) {
  const statement = await prisma.statement.findUnique({
    where: { documentId },
    include: {
      transactions: {
        orderBy: { transactionDate: "asc" },
      },
    },
  });

  return statement;
}

/**
 * Retrieves the list of recently analyzed documents and their metadata.
 */
export async function getRecentDocuments(limit = 10) {
  return await prisma.document.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      metadata: true,
      statement: true,
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 2,
      },
    },
  });
}
