import crypto from "crypto";
import { getDocumentProxy, getMeta } from "unpdf";
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
function cleanMetadataString(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str.length > 0 ? str : null;
}

/**
 * Helper to parse various PDF date string formats (e.g. D:YYYYMMDDHHmmSS or ISO)
 */
function parsePdfDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val !== "string") return null;

  let str = val.trim();
  if (str.startsWith("D:")) {
    str = str.substring(2);
  }
  const parsedDirect = new Date(str);
  if (!isNaN(parsedDirect.getTime())) return parsedDirect;

  const match = str.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = match[2] ? parseInt(match[2], 10) - 1 : 0;
    const day = match[3] ? parseInt(match[3], 10) : 1;
    const hour = match[4] ? parseInt(match[4], 10) : 0;
    const min = match[5] ? parseInt(match[5], 10) : 0;
    const sec = match[6] ? parseInt(match[6], 10) : 0;
    const d = new Date(Date.UTC(year, month, day, hour, min, sec));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Estimates page count directly from raw PDF objects as an emergency fallback
 */
function countPagesFromRawBuffer(buffer: Buffer): number {
  const text = buffer.toString("binary");
  // Look for /Type /Page (excluding /Pages)
  const matches = text.match(/\/Type\s*\/Page\b(?!\s*s)/g);
  if (matches && matches.length > 0) {
    return matches.length;
  }
  // Look for /Count N in page trees
  const countMatches = text.match(/\/Count\s+(\d+)/g);
  if (countMatches && countMatches.length > 0) {
    let max = 0;
    for (const cm of countMatches) {
      const num = parseInt(cm.replace(/\D/g, ""), 10);
      if (num > max) max = num;
    }
    if (max > 0) return max;
  }
  return 0;
}

/**
 * Parses the PDF document and extracts all standard metadata attributes,
 * page count, version, and raw dictionary values.
 * Uses a resilient multi-tier engine (unpdf / PDF.js + pdf-lib + raw stream scanner)
 * to eliminate "Expected instance of PDFDict" and corrupted catalog errors.
 */
export async function inspectPdfMetadata(buffer: Buffer): Promise<ExtractedPdfMetadata> {
  const validation = validatePdfBuffer(buffer);
  if (!validation.valid) {
    throw new Error(validation.error || "PDF validation failed.");
  }

  const fileHash = calculateFileHash(buffer);
  let pdfVersion = extractPdfVersion(buffer);

  let pageCount = 0;
  let rawTitle: string | null = null;
  let rawAuthor: string | null = null;
  let rawSubject: string | null = null;
  let rawCreator: string | null = null;
  let rawProducer: string | null = null;
  let rawCreationDate: Date | null = null;
  let rawModDate: Date | null = null;
  let unpdfMetaInfo: Record<string, unknown> | null = null;

  // Tier 1: Modern PDF.js via unpdf (Handles broken, non-standard, and banking statement catalogs)
  try {
    const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const pdf = await getDocumentProxy(uint8Array);
    if (pdf && typeof pdf.numPages === "number" && pdf.numPages > 0) {
      pageCount = pdf.numPages;
    }
    const meta = await getMeta(pdf).catch(() => null);
    if (meta && meta.info) {
      unpdfMetaInfo = meta.info as Record<string, unknown>;
      rawTitle = cleanMetadataString(unpdfMetaInfo.Title);
      rawAuthor = cleanMetadataString(unpdfMetaInfo.Author);
      rawSubject = cleanMetadataString(unpdfMetaInfo.Subject);
      rawCreator = cleanMetadataString(unpdfMetaInfo.Creator);
      rawProducer = cleanMetadataString(unpdfMetaInfo.Producer);
      rawCreationDate = parsePdfDate(unpdfMetaInfo.CreationDate);
      rawModDate = parsePdfDate(unpdfMetaInfo.ModDate);
      if (!pdfVersion && unpdfMetaInfo.PDFFormatVersion) {
        pdfVersion = String(unpdfMetaInfo.PDFFormatVersion);
      }
    }
  } catch (unpdfErr: unknown) {
    console.warn("[PDF_INSPECTOR] unpdf parse warning:", unpdfErr);
  }

  // Tier 2: pdf-lib (Enrichment / Secondary fallback, guarded against PDFDict failures)
  if (pageCount <= 0 || !rawTitle || !rawAuthor) {
    try {
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        updateMetadata: false,
      });

      if (pageCount <= 0) {
        try {
          const docPages = pdfDoc.getPageCount();
          if (docPages > 0) pageCount = docPages;
        } catch {
          // Ignore pdf-lib page catalog crash
        }
      }

      rawTitle = rawTitle || cleanMetadataString(pdfDoc.getTitle());
      rawAuthor = rawAuthor || cleanMetadataString(pdfDoc.getAuthor());
      rawSubject = rawSubject || cleanMetadataString(pdfDoc.getSubject());
      rawCreator = rawCreator || cleanMetadataString(pdfDoc.getCreator());
      rawProducer = rawProducer || cleanMetadataString(pdfDoc.getProducer());
      rawCreationDate = rawCreationDate || pdfDoc.getCreationDate() || null;
      rawModDate = rawModDate || pdfDoc.getModificationDate() || null;
    } catch {
      // Ignore pdf-lib error gracefully
    }
  }

  // Tier 3: Raw Buffer Page Counter Fallback
  if (pageCount <= 0) {
    pageCount = countPagesFromRawBuffer(buffer);
  }

  // Minimum sanity check
  if (pageCount <= 0) {
    throw new Error("Invalid PDF: The document contains 0 readable pages or has an unrecoverable structure.");
  }

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
    extraInfo: unpdfMetaInfo ?? undefined,
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
