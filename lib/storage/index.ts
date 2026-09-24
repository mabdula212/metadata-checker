import crypto from "crypto";
import { prisma } from "../db/prisma.js";
import type { StorageProvider, StorageKeyInfo } from "./types.js";
import { LocalStorageProvider } from "./local.js";
import { VercelBlobStorageProvider } from "./vercel-blob.js";

export * from "./types.js";
export * from "./local.js";
export * from "./vercel-blob.js";

let activeStorageProvider: StorageProvider | null = null;

/**
 * Returns the active StorageProvider instance based on environment configuration.
 * - Safe development default: "local" (uses LocalStorageProvider).
 * - For production/Vercel: Activated when STORAGE_PROVIDER=vercel-blob.
 * - BLOB_READ_WRITE_TOKEN is optional and only required when using Vercel Blob.
 */
export function getStorageProvider(): StorageProvider {
  if (activeStorageProvider) {
    return activeStorageProvider;
  }

  const providerName = (process.env.STORAGE_PROVIDER || "local").toLowerCase().trim();

  if (providerName === "vercel-blob") {
    activeStorageProvider = new VercelBlobStorageProvider();
  } else {
    activeStorageProvider = new LocalStorageProvider();
  }

  return activeStorageProvider;
}

/**
 * Allows overriding or resetting the storage provider (used primarily in test suites).
 */
export function setStorageProvider(provider: StorageProvider | null): void {
  activeStorageProvider = provider;
}

/**
 * Generates a canonical storage key and sanitized stored file name for a document.
 * Canonical pattern: `documents/{documentId}/{storedFileName}`
 */
export function generateStorageKey(
  documentId: string,
  originalFileName: string
): StorageKeyInfo {
  const sanitizedName = originalFileName
    .replace(/\.\./g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_");
  const storedFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${sanitizedName}`;
  const storageKey = `documents/${documentId}/${storedFileName}`;

  return { storageKey, storedFileName };
}

/**
 * Verifies whether a binary buffer begins with the standard %PDF- header signature.
 */
export function isPdfBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) return false;
  const header = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("ascii");
  return header.includes("%PDF-");
}

export interface RetrievedDocumentPdf {
  buffer: Buffer;
  document: {
    id: string;
    originalFileName: string;
    storedFileName: string;
    storageKey: string;
    mimeType: string;
    fileSize: number;
    status: string;
    documentType: string;
  };
}

/**
 * Canonical server-side function to retrieve the original uploaded PDF.
 *
 * Requirements satisfied:
 * 1. Loads Document from PostgreSQL.
 * 2. Reads canonical storageKey.
 * 3. Retrieves PDF bytes through the configured StorageProvider.
 * 4. Verifies the content is actually a valid PDF (%PDF-).
 * 5. Returns safe bytes and Document metadata.
 * 6. Never exposes storage credentials or internal filesystem paths.
 */
export async function getDocumentPdf(
  documentId: string
): Promise<RetrievedDocumentPdf> {
  if (!documentId || typeof documentId !== "string") {
    throw new Error("Invalid document ID provided.");
  }

  // 1. Load Document from PostgreSQL
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      originalFileName: true,
      storedFileName: true,
      storageKey: true,
      mimeType: true,
      fileSize: true,
      status: true,
      documentType: true,
    },
  });

  if (!document) {
    throw new Error("Document not found.");
  }

  if (!document.storageKey) {
    throw new Error("Document storage reference is missing.");
  }

  // 2. Retrieve PDF through StorageProvider
  const provider = getStorageProvider();
  let buffer: Buffer;

  try {
    buffer = await provider.download(document.storageKey);
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : "Storage download error";
    // Sanitize message: never leak full local filesystem paths or token secrets
    const sanitizedMsg = rawMsg
      .replace(/token\s+[^\s]+/gi, "token [REDACTED]")
      .replace(/[\/\\][^\s]+/g, "[path]");
    throw new Error(`Failed to retrieve document file from storage: ${sanitizedMsg}`);
  }

  // 3. Verify the content is actually a valid PDF
  if (!isPdfBuffer(buffer)) {
    throw new Error(
      "Corrupted document: Stored file does not contain the required %PDF- signature."
    );
  }

  return {
    buffer,
    document,
  };
}
