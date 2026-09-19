import crypto from "crypto";
import { PDFDocument } from "pdf-lib";

export const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
export const PDF_MAGIC_BYTES = "%PDF-";

export interface ExtractedPdfMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: Date | null;
  modificationDate: Date | null;
  pdfVersion: string | null;
  pageCount: number;
  fileHash: string;
  rawMetadataJson: Record<string, unknown>;
}

export interface PdfValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates the raw buffer of an uploaded PDF.
 * Checks minimum length, maximum size (20MB), and the %PDF- magic signature.
 */
export function validatePdfBuffer(buffer: Buffer): PdfValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: "The provided file is empty (0 bytes)." };
  }

  if (buffer.length > MAX_PDF_SIZE_BYTES) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `File size (${sizeMb} MB) exceeds the maximum allowed limit of 20 MB.`,
    };
  }

  // Check PDF signature in the first 1024 bytes (some PDFs have UTF-8 BOM or leading comment)
  const headerSnippet = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("ascii");
  if (!headerSnippet.includes(PDF_MAGIC_BYTES)) {
    return {
      valid: false,
      error: "Invalid file signature: The file is not a valid PDF (missing %PDF- header).",
    };
  }

  return { valid: true };
}

/**
 * Calculates SHA-256 cryptographic checksum of a buffer.
 */
export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Extracts PDF version from header bytes (e.g. 1.4, 1.7, 2.0).
 */
export function extractPdfVersion(buffer: Buffer): string | null {
  const headerSnippet = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("ascii");
  const match = headerSnippet.match(/%PDF-(\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Helper to safely sanitize string metadata from PDF dictionaries.
 */
function cleanMetadataString(val: string | undefined | null): string | null {
  if (val === undefined || val === null) return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parses the PDF document and extracts all standard metadata attributes,
 * page count, version, and raw dictionary values.
 */
export async function inspectPdfMetadata(buffer: Buffer): Promise<ExtractedPdfMetadata> {
  const validation = validatePdfBuffer(buffer);
  if (!validation.valid) {
    throw new Error(validation.error || "PDF validation failed.");
  }

  const fileHash = calculateFileHash(buffer);
  const pdfVersion = extractPdfVersion(buffer);

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Parsing failed";
    throw new Error(`Failed to read PDF document: Corrupted or unreadable PDF structure (${msg}).`);
  }

  let pageCount = 0;
  try {
    pageCount = pdfDoc.getPageCount();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Page tree corrupt";
    throw new Error(`Failed to read PDF pages: Corrupted PDF page catalog (${msg}).`);
  }

  if (pageCount <= 0) {
    throw new Error("Invalid PDF: The document contains 0 pages.");
  }

  // Extract standard metadata fields
  const rawTitle = cleanMetadataString(pdfDoc.getTitle());
  const rawAuthor = cleanMetadataString(pdfDoc.getAuthor());
  const rawSubject = cleanMetadataString(pdfDoc.getSubject());
  const rawCreator = cleanMetadataString(pdfDoc.getCreator());
  const rawProducer = cleanMetadataString(pdfDoc.getProducer());
  const rawCreationDate = pdfDoc.getCreationDate() ?? null;
  const rawModDate = pdfDoc.getModificationDate() ?? null;

  // Build raw JSON payload for audit/debugging
  const rawMetadataJson: Record<string, unknown> = {
    title: rawTitle,
    author: rawAuthor,
    subject: rawSubject,
    creator: rawCreator,
    producer: rawProducer,
    creationDate: rawCreationDate ? rawCreationDate.toISOString() : null,
    modificationDate: rawModDate ? rawModDate.toISOString() : null,
    pdfVersion,
    pageCount,
    fileSizeBytes: buffer.length,
    fileHash,
  };

  return {
    title: rawTitle,
    author: rawAuthor,
    subject: rawSubject,
    creator: rawCreator,
    producer: rawProducer,
    creationDate: rawCreationDate,
    modificationDate: rawModDate,
    pdfVersion,
    pageCount,
    fileHash,
    rawMetadataJson,
  };
}
