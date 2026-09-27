import { isEncrypted, decryptPDF } from "@pdfsmaller/pdf-decrypt";
import { PDFDocument } from "pdf-lib";
import { createStableByteCopy, PDF_MAGIC_BYTES } from "./pdf-inspector.js";

export type PdfSecurityState =
  | "UNPROTECTED"
  | "PASSWORD_PROTECTED"
  | "INVALID_PDF"
  | "UNSUPPORTED_ENCRYPTION";

export interface PdfEncryptionInfo {
  securityState: PdfSecurityState;
  isEncrypted: boolean;
  algorithm?: string;
  version?: number;
  revision?: number;
  keyLength?: number;
  errorMessage?: string;
}

export interface DecryptPdfResult {
  success: boolean;
  decryptedBytes?: Uint8Array;
  decryptedBuffer?: Buffer;
  securityState: PdfSecurityState;
  error?: string;
  algorithm?: string;
}

// In-memory cache for decrypted buffers during multi-step processing (5 minute TTL)
// Allows /api/bank-detection and /api/transaction-extraction to execute in-memory
// without permanently saving decrypted copies to disk or storage.
interface CachedDecryptedEntry {
  buffer: Buffer;
  expiresAt: number;
}
const decryptedBufferCache = new Map<string, CachedDecryptedEntry>();

export function storeDecryptedBuffer(documentId: string, buffer: Buffer): void {
  // 5 minutes expiry
  decryptedBufferCache.set(documentId, {
    buffer,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
}

export function getDecryptedBuffer(documentId: string): Buffer | null {
  const entry = decryptedBufferCache.get(documentId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    decryptedBufferCache.delete(documentId);
    return null;
  }
  return entry.buffer;
}

export function clearDecryptedBuffer(documentId: string): void {
  decryptedBufferCache.delete(documentId);
}

/**
 * Validates header signature and determines whether the uploaded PDF is encrypted.
 * Returns a security state: UNPROTECTED, PASSWORD_PROTECTED, INVALID_PDF, or UNSUPPORTED_ENCRYPTION.
 */
export async function detectEncryption(input: Buffer | Uint8Array): Promise<PdfEncryptionInfo> {
  if (!input || input.length === 0) {
    return {
      securityState: "INVALID_PDF",
      isEncrypted: false,
      errorMessage: "The provided file is empty (0 bytes).",
    };
  }

  const bytes = createStableByteCopy(input);

  // Validate PDF magic bytes
  const headerSlice = bytes.subarray(0, Math.min(bytes.length, 1024));
  let headerText = "";
  for (let i = 0; i < headerSlice.length; i++) {
    headerText += String.fromCharCode(headerSlice[i]);
  }

  if (!headerText.includes(PDF_MAGIC_BYTES)) {
    return {
      securityState: "INVALID_PDF",
      isEncrypted: false,
      errorMessage: "Invalid file signature: The file is not a valid PDF (missing %PDF- header).",
    };
  }

  try {
    const encInfo = await isEncrypted(bytes);

    if (!encInfo.encrypted) {
      return {
        securityState: "UNPROTECTED",
        isEncrypted: false,
      };
    }

    console.log("[PDF_SECURITY] encrypted PDF detected");

    // Check if algorithm is recognized
    const algo = (encInfo.algorithm || "").toUpperCase();
    const isSupported =
      algo.includes("AES-256") ||
      algo.includes("RC4") ||
      algo.includes("AES") ||
      encInfo.version === 4 ||
      encInfo.version === 5 ||
      encInfo.version === 2 ||
      encInfo.version === 1;

    if (isSupported) {
      return {
        securityState: "PASSWORD_PROTECTED",
        isEncrypted: true,
        algorithm: encInfo.algorithm,
        version: encInfo.version,
        revision: encInfo.revision,
        keyLength: encInfo.keyLength,
      };
    }

    console.log("[PDF_SECURITY] unsupported encryption encountered");
    return {
      securityState: "UNSUPPORTED_ENCRYPTION",
      isEncrypted: true,
      algorithm: encInfo.algorithm || "CUSTOM_OR_PROPRIETARY",
      errorMessage: "Jenis enkripsi PDF ini belum didukung.",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.toLowerCase().includes("unsupported") || msg.toLowerCase().includes("filter")) {
      console.log("[PDF_SECURITY] unsupported encryption encountered");
      return {
        securityState: "UNSUPPORTED_ENCRYPTION",
        isEncrypted: true,
        errorMessage: "Jenis enkripsi PDF ini belum didukung.",
      };
    }

    // Check raw trailer /Encrypt dictionary as fallback
    const rawString = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 4096)));
    if (rawString.includes("/Encrypt")) {
      console.log("[PDF_SECURITY] encrypted PDF detected");
      return {
        securityState: "PASSWORD_PROTECTED",
        isEncrypted: true,
      };
    }

    return {
      securityState: "UNPROTECTED",
      isEncrypted: false,
    };
  }
}

/**
 * Decrypts a password-protected PDF in-memory using pure Web Crypto API.
 * Never logs or exposes passwords, cryptographic keys, or document bytes.
 */
export async function decryptPdf(
  input: Buffer | Uint8Array,
  password?: string | null
): Promise<DecryptPdfResult> {
  const bytes = createStableByteCopy(input);

  // Detect encryption status first
  const detection = await detectEncryption(bytes);
  if (detection.securityState === "INVALID_PDF") {
    return {
      success: false,
      securityState: "INVALID_PDF",
      error: detection.errorMessage || "Invalid PDF file.",
    };
  }

  if (detection.securityState === "UNSUPPORTED_ENCRYPTION") {
    return {
      success: false,
      securityState: "UNSUPPORTED_ENCRYPTION",
      error: "Jenis enkripsi PDF ini belum didukung.",
      algorithm: detection.algorithm,
    };
  }

  if (detection.securityState === "UNPROTECTED") {
    return {
      success: true,
      decryptedBytes: bytes,
      decryptedBuffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      securityState: "UNPROTECTED",
    };
  }

  // Password is required
  if (!password || password.trim().length === 0) {
    return {
      success: false,
      securityState: "PASSWORD_PROTECTED",
      error: "Dokumen ini dilindungi password. Masukkan password PDF untuk melanjutkan analisis.",
      algorithm: detection.algorithm,
    };
  }

  console.log("[PDF_SECURITY] password supplied");
  console.log("[PDF_SECURITY] decryption started");

  try {
    const rawDecryptedBytes = await decryptPDF(bytes, password);
    console.log("[PDF_SECURITY] decryption completed");

    // Normalize decrypted PDF bytes through pdf-lib into a standard unencrypted PDF
    let normalizedBytes = rawDecryptedBytes;
    try {
      normalizedBytes = await normalizePdf(rawDecryptedBytes);
    } catch {
      // Fallback to raw decrypted bytes if already clean
    }

    const decryptedBuffer = Buffer.from(
      normalizedBytes.buffer,
      normalizedBytes.byteOffset,
      normalizedBytes.byteLength
    );

    return {
      success: true,
      decryptedBytes: normalizedBytes,
      decryptedBuffer,
      securityState: "PASSWORD_PROTECTED",
      algorithm: detection.algorithm,
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : "";
    console.log("[PDF_SECURITY] password validation failed");

    if (rawMsg.toLowerCase().includes("unsupported")) {
      return {
        success: false,
        securityState: "UNSUPPORTED_ENCRYPTION",
        error: "Jenis enkripsi PDF ini belum didukung.",
        algorithm: detection.algorithm,
      };
    }

    // Safe error message required by specification:
    // Do NOT expose cryptographic/library internals. Do NOT reveal whether password is almost correct.
    return {
      success: false,
      securityState: "PASSWORD_PROTECTED",
      error: "Password PDF salah atau dokumen tidak dapat dibuka.",
      algorithm: detection.algorithm,
    };
  }
}

/**
 * Normalizes decrypted PDF bytes through pdf-lib into an unencrypted standard PDF representation.
 * Leaves the normalized PDF in memory without permanently writing to storage.
 */
export async function normalizePdf(decryptedBytes: Uint8Array): Promise<Uint8Array> {
  const stableBytes = createStableByteCopy(decryptedBytes);
  const pdfDoc = await PDFDocument.load(stableBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  return await pdfDoc.save();
}
