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
 * Creates an independent, isolated Uint8Array copy from any Buffer, Uint8Array, or ArrayBuffer.
 * Allocates a pristine ArrayBuffer slice so downstream operations (pdf-lib, unpdf, crypto, fetch)
 * can never transfer, detach, or mutate the original buffer.
 */
export function createStableByteCopy(input: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (!input) {
    return new Uint8Array(0);
  }
  if (input instanceof ArrayBuffer) {
    if ((input as unknown as { detached?: boolean }).detached) {
      throw new Error("Cannot create byte copy from a detached ArrayBuffer.");
    }
    return new Uint8Array(input.slice(0));
  }
  if (ArrayBuffer.isView(input)) {
    if ((input.buffer as unknown as { detached?: boolean }).detached) {
      throw new Error("Cannot create byte copy from a detached ArrayBuffer.");
    }
    // Allocate fresh ArrayBuffer slice matching exact byte range
    const clonedArrayBuffer = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength
    );
    return new Uint8Array(clonedArrayBuffer);
  }
  throw new Error("Invalid input: expected Buffer, Uint8Array, or ArrayBuffer.");
}

/**
 * Creates an independent Node.js Buffer copy backed by a dedicated, non-shared ArrayBuffer.
 */
export function createStableBufferCopy(input: Buffer | Uint8Array | ArrayBuffer): Buffer {
  const bytes = createStableByteCopy(input);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Validates the raw buffer or byte array of an uploaded PDF.
 * Checks minimum length, maximum size (20MB), and the %PDF- magic signature.
 */
export function validatePdfBuffer(input: Buffer | Uint8Array): PdfValidationResult {
  if (!input || input.length === 0) {
    return { valid: false, error: "The provided file is empty (0 bytes)." };
  }

  if (input.length > MAX_PDF_SIZE_BYTES) {
    const sizeMb = (input.length / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `File size (${sizeMb} MB) exceeds the maximum allowed limit of 20 MB.`,
    };
  }

  // Check PDF signature in the first 1024 bytes (some PDFs have UTF-8 BOM or leading comment)
  const headerSlice = input.subarray(0, Math.min(input.length, 1024));
  let headerText = "";
  for (let i = 0; i < headerSlice.length; i++) {
    headerText += String.fromCharCode(headerSlice[i]);
  }

  if (!headerText.includes(PDF_MAGIC_BYTES)) {
    return {
      valid: false,
      error: "Invalid file signature: The file is not a valid PDF (missing %PDF- header).",
    };
  }

  return { valid: true };
}

/**
 * Calculates SHA-256 cryptographic checksum of a buffer or byte array.
 * Uses an independent byte copy so hashing never transfers or detaches downstream buffers.
 */
export function calculateFileHash(input: Buffer | Uint8Array): string {
  const stableBytes = createStableByteCopy(input);
  return crypto.createHash("sha256").update(stableBytes).digest("hex");
}

/**
 * Extracts PDF version from header bytes (e.g. 1.4, 1.7, 2.0).
 */
export function extractPdfVersion(input: Buffer | Uint8Array): string | null {
  const headerSlice = input.subarray(0, Math.min(input.length, 1024));
  let headerText = "";
  for (let i = 0; i < headerSlice.length; i++) {
    headerText += String.fromCharCode(headerSlice[i]);
  }
  const match = headerText.match(/%PDF-(\d+\.\d+)/);
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
function countPagesFromRawBytes(input: Uint8Array): number {
  let text = "";
  // Decode in chunks to avoid call stack limits on large buffers
  const chunkSize = 8192;
  for (let i = 0; i < input.length; i += chunkSize) {
    const slice = input.subarray(i, Math.min(i + chunkSize, input.length));
    for (let j = 0; j < slice.length; j++) {
      text += String.fromCharCode(slice[j]);
    }
  }

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
 *
 * Architecture:
 * 1. Creates a stable, independent byte representation immediately.
 * 2. Validates PDF magic bytes (%PDF-).
 * 3. Computes SHA-256 using an isolated byte copy.
 * 4. Inspects PDF via pdf-lib using an independent Uint8Array copy.
 * 5. Uses unpdf with an isolated byte copy if enrichment/fallback is needed.
 * 6. Guarantees that neither caller nor downstream operations encounter a detached ArrayBuffer.
 */
export async function inspectPdfMetadata(input: Buffer | Uint8Array): Promise<ExtractedPdfMetadata> {
  // 1. Create stable independent byte copy
  const stableBytes = createStableByteCopy(input);

  // 2. Validate PDF magic bytes
  const validation = validatePdfBuffer(stableBytes);
  if (!validation.valid) {
    throw new Error(validation.error || "PDF validation failed.");
  }
  console.log("[PDF_INSPECT] PDF magic validated");

  // 3. Calculate SHA-256 checksum from an independent copy
  const fileHash = calculateFileHash(stableBytes);
  console.log("[PDF_INSPECT] SHA-256 calculated");

  let pdfVersion = extractPdfVersion(stableBytes);
  let pageCount = 0;
  let rawTitle: string | null = null;
  let rawAuthor: string | null = null;
  let rawSubject: string | null = null;
  let rawCreator: string | null = null;
  let rawProducer: string | null = null;
  let rawCreationDate: Date | null = null;
  let rawModDate: Date | null = null;
  let unpdfMetaInfo: Record<string, unknown> | null = null;

  // 4. pdf-lib inspection using a dedicated independent copy
  console.log("[PDF_INSPECT] pdf-lib inspection started");
  try {
    const pdfBytes = createStableByteCopy(stableBytes);
    const pdfDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    try {
      const docPages = pdfDoc.getPageCount();
      if (docPages > 0) pageCount = docPages;
    } catch {
      // Page catalog parsing error, fallback will attempt recovery
    }

    rawTitle = cleanMetadataString(pdfDoc.getTitle());
    rawAuthor = cleanMetadataString(pdfDoc.getAuthor());
    rawSubject = cleanMetadataString(pdfDoc.getSubject());
    rawCreator = cleanMetadataString(pdfDoc.getCreator());
    rawProducer = cleanMetadataString(pdfDoc.getProducer());
    rawCreationDate = pdfDoc.getCreationDate() ?? null;
    rawModDate = pdfDoc.getModificationDate() ?? null;

    console.log("[PDF_INSPECT] pdf-lib inspection completed");
  } catch (pdfLibErr: unknown) {
    console.warn(
      "[PDF_INSPECT] pdf-lib inspection non-fatal warning:",
      pdfLibErr instanceof Error ? pdfLibErr.message : "Parsing issue"
    );
  }

  // 5. Fallback Tier: Modern unpdf / PDF.js (for non-standard catalogs)
  // CRITICAL: Always allocate an independent copy so unpdf/PDF.js cannot detach stableBytes!
  if (pageCount <= 0 || !rawTitle || !rawAuthor) {
    try {
      const unpdfBytes = createStableByteCopy(stableBytes);
      const pdf = await getDocumentProxy(unpdfBytes);
      if (pdf && typeof pdf.numPages === "number" && pdf.numPages > 0) {
        if (pageCount <= 0) pageCount = pdf.numPages;
      }
      const meta = await getMeta(pdf).catch(() => null);
      if (meta && meta.info) {
        unpdfMetaInfo = meta.info as Record<string, unknown>;
        rawTitle = rawTitle || cleanMetadataString(unpdfMetaInfo.Title);
        rawAuthor = rawAuthor || cleanMetadataString(unpdfMetaInfo.Author);
        rawSubject = rawSubject || cleanMetadataString(unpdfMetaInfo.Subject);
        rawCreator = cleanMetadataString(unpdfMetaInfo.Creator);
        rawProducer = cleanMetadataString(unpdfMetaInfo.Producer);
        rawCreationDate = rawCreationDate || parsePdfDate(unpdfMetaInfo.CreationDate);
        rawModDate = rawModDate || parsePdfDate(unpdfMetaInfo.ModDate);
        if (!pdfVersion && unpdfMetaInfo.PDFFormatVersion) {
          pdfVersion = String(unpdfMetaInfo.PDFFormatVersion);
        }
      }
    } catch (unpdfErr: unknown) {
      console.warn(
        "[PDF_INSPECT] unpdf fallback warning:",
        unpdfErr instanceof Error ? unpdfErr.message : "unpdf error"
      );
    }
  }

  // 6. Fallback Tier: Raw Buffer Page Counter Fallback
  if (pageCount <= 0) {
    pageCount = countPagesFromRawBytes(stableBytes);
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
    fileSizeBytes: stableBytes.length,
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
