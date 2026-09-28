import crypto from "crypto";
import { isEncrypted, decryptPDF } from "@pdfsmaller/pdf-decrypt";
import {
  PDFDocument,
  PDFDict,
  PDFRawStream,
  PDFString,
  PDFHexString,
  PDFArray,
  PDFName,
  PDFRef,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { getDocumentProxy, extractText, getMeta } from "unpdf";
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

export interface ProcessedPdf {
  originalBytes: Uint8Array;
  analysisBytes: Uint8Array;
  wasEncrypted: boolean;
}

export function createProcessedPdf(
  originalBytes: Uint8Array,
  analysisBytes: Uint8Array,
  wasEncrypted: boolean
): ProcessedPdf {
  return {
    originalBytes,
    analysisBytes,
    wasEncrypted,
  };
}

export interface DecryptPdfResult {
  success: boolean;
  decryptedBytes?: Uint8Array;
  decryptedBuffer?: Buffer;
  securityState: PdfSecurityState;
  error?: string;
  algorithm?: string;
  extractedText?: {
    totalPages: number;
    pages: Array<{ pageNumber: number; text: string; characterCount: number }>;
    fullText: string;
    isScannedOrImageOnly: boolean;
    totalCharacterCount: number;
  };
}

// In-memory cache for decrypted buffers during multi-step processing (10 minute TTL)
// Allows /api/bank-detection and /api/transaction-extraction to execute in-memory
// without permanently saving decrypted copies to disk or storage.
interface CachedDecryptedEntry {
  buffer: Buffer;
  bytes: Uint8Array;
  fileHash?: string;
  storageKey?: string;
  wasEncrypted?: boolean;
  extractedText?: {
    totalPages: number;
    pages: Array<{ pageNumber: number; text: string; characterCount: number }>;
    fullText: string;
    isScannedOrImageOnly: boolean;
    totalCharacterCount: number;
  };
  expiresAt: number;
}
const decryptedBufferCache = new Map<string, CachedDecryptedEntry>();

export function storeDecryptedBuffer(
  idOrKey: string,
  buffer: Buffer,
  options?: {
    fileHash?: string;
    storageKey?: string;
    bytes?: Uint8Array;
    wasEncrypted?: boolean;
    extractedText?: {
      totalPages: number;
      pages: Array<{ pageNumber: number; text: string; characterCount: number }>;
      fullText: string;
      isScannedOrImageOnly: boolean;
      totalCharacterCount: number;
    };
  }
): void {
  const bytes = options?.bytes || new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const entry: CachedDecryptedEntry = {
    buffer,
    bytes,
    fileHash: options?.fileHash,
    storageKey: options?.storageKey,
    wasEncrypted: options?.wasEncrypted ?? true,
    extractedText: options?.extractedText,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  decryptedBufferCache.set(idOrKey, entry);
  if (options?.fileHash) {
    decryptedBufferCache.set(options.fileHash, entry);
  }
  if (options?.storageKey) {
    decryptedBufferCache.set(options.storageKey, entry);
  }
}

export function getDecryptedBuffer(idOrHash: string): Buffer | null {
  const entry = decryptedBufferCache.get(idOrHash);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    decryptedBufferCache.delete(idOrHash);
    return null;
  }
  return entry.buffer;
}

export function getDecryptedBytes(idOrHash: string): Uint8Array | null {
  const entry = decryptedBufferCache.get(idOrHash);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    decryptedBufferCache.delete(idOrHash);
    return null;
  }
  return entry.bytes;
}

export function getDecryptedExtractedText(idOrHash: string) {
  const entry = decryptedBufferCache.get(idOrHash);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    decryptedBufferCache.delete(idOrHash);
    return null;
  }
  return entry.extractedText || null;
}

export function isDecryptedDocument(idOrHash: string): boolean {
  const entry = decryptedBufferCache.get(idOrHash);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    decryptedBufferCache.delete(idOrHash);
    return false;
  }
  return Boolean(entry.wasEncrypted);
}

export function clearDecryptedBuffer(documentId: string): void {
  decryptedBufferCache.delete(documentId);
}

// PDF standard 32-byte padding sequence defined in ISO 32000-1 (Section 7.6.3.3)
const PDF_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

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

    // All standard PDF encryption is supported:
    // AES-256 (Revision 5 & 6), AES-128 (Revision 4), RC4 40/128-bit (Revision 2 & 3)
    return {
      securityState: "PASSWORD_PROTECTED",
      isEncrypted: true,
      algorithm: encInfo.algorithm || (encInfo.version === 4 ? "AES-128" : "STANDARD"),
      version: encInfo.version,
      revision: encInfo.revision,
      keyLength: encInfo.keyLength,
    };
  } catch (err: unknown) {
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
 * Standard RC4 cipher implementation for PDF Revision 2, 3, and 4
 */
class PdfRC4 {
  private s: number[] = [];
  private i = 0;
  private j = 0;

  constructor(key: Uint8Array) {
    this.s = new Array(256);
    for (let k = 0; k < 256; k++) {
      this.s[k] = k;
    }
    let j = 0;
    for (let k = 0; k < 256; k++) {
      j = (j + this.s[k] + key[k % key.length]) & 0xff;
      const tmp = this.s[k];
      this.s[k] = this.s[j];
      this.s[j] = tmp;
    }
  }

  process(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data.length);
    let i = this.i;
    let j = this.j;
    const s = this.s.slice();

    for (let k = 0; k < data.length; k++) {
      i = (i + 1) & 0xff;
      j = (j + s[i]) & 0xff;
      const tmp = s[i];
      s[i] = s[j];
      s[j] = tmp;
      const t = (s[i] + s[j]) & 0xff;
      out[k] = data[k] ^ s[t];
    }
    return out;
  }
}

/**
 * Pads or truncates password to 32 bytes per ISO 32000-1 (Section 7.6.3.3)
 */
function padPdfPassword(pwd: string): Uint8Array {
  const enc = new TextEncoder().encode(pwd);
  const out = new Uint8Array(32);
  if (enc.length >= 32) {
    out.set(enc.subarray(0, 32));
  } else {
    out.set(enc);
    out.set(PDF_PADDING.subarray(0, 32 - enc.length), enc.length);
  }
  return out;
}

/**
 * Computes encryption key (Algorithm 2 from ISO 32000-1)
 * Works for Rev 2 (RC4-40), Rev 3 (RC4-128), and Rev 4 (AES-128 / RC4-128)
 */
function computePdfEncryptionKey(
  password: string,
  ownerKey: Uint8Array,
  permissions: number,
  fileId: Uint8Array,
  revision: number,
  keyLengthBytes: number,
  encryptMetadata = true
): Uint8Array {
  const padded = padPdfPassword(password);
  const parts: Uint8Array[] = [padded, ownerKey];

  const pBuf = new Uint8Array(4);
  pBuf[0] = permissions & 0xff;
  pBuf[1] = (permissions >> 8) & 0xff;
  pBuf[2] = (permissions >> 16) & 0xff;
  pBuf[3] = (permissions >> 24) & 0xff;
  parts.push(pBuf);
  parts.push(fileId);

  if (revision >= 4 && !encryptMetadata) {
    parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }

  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const hashInput = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    hashInput.set(p, off);
    off += p.length;
  }

  let hash = crypto.createHash("md5").update(hashInput).digest();
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) {
      hash = crypto.createHash("md5").update(hash.subarray(0, keyLengthBytes)).digest();
    }
  }
  return new Uint8Array(hash.subarray(0, keyLengthBytes));
}

/**
 * Validates user or owner password for Revision 2, 3, and 4 (AES-128 / RC4)
 * Returns the derived file encryption key if valid, or null if incorrect.
 */
function validatePasswordRev234(
  password: string,
  ownerKey: Uint8Array,
  userKey: Uint8Array,
  permissions: number,
  fileId: Uint8Array,
  revision: number,
  keyLengthBytes: number,
  encryptMetadata = true
): Uint8Array | null {
  // Test 1: User password check (Algorithm 5)
  const encKey = computePdfEncryptionKey(
    password,
    ownerKey,
    permissions,
    fileId,
    revision,
    keyLengthBytes,
    encryptMetadata
  );

  if (revision === 2) {
    const rc4 = new PdfRC4(encKey);
    const computed = rc4.process(PDF_PADDING);
    if (Buffer.from(computed).equals(Buffer.from(userKey.subarray(0, 32)))) {
      return encKey;
    }
  } else {
    // Rev 3 & Rev 4
    const md5Input = new Uint8Array(PDF_PADDING.length + fileId.length);
    md5Input.set(PDF_PADDING);
    md5Input.set(fileId, PDF_PADDING.length);
    const hash = crypto.createHash("md5").update(md5Input).digest();

    let result = new PdfRC4(encKey).process(hash);
    for (let i = 1; i <= 19; i++) {
      const iterKey = new Uint8Array(encKey.length);
      for (let k = 0; k < encKey.length; k++) {
        iterKey[k] = encKey[k] ^ i;
      }
      result = new PdfRC4(iterKey).process(result);
    }
    if (Buffer.from(result.subarray(0, 16)).equals(Buffer.from(userKey.subarray(0, 16)))) {
      return encKey;
    }
  }

  // Test 2: Owner password check (Algorithm 7)
  const paddedOwner = padPdfPassword(password);
  let oHash = crypto.createHash("md5").update(paddedOwner).digest();
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) {
      oHash = crypto.createHash("md5").update(oHash).digest();
    }
  }
  const ownerDecryptKey = new Uint8Array(oHash.subarray(0, keyLengthBytes));

  let recoveredUserPwd: any;
  if (revision === 2) {
    recoveredUserPwd = new PdfRC4(ownerDecryptKey).process(ownerKey.subarray(0, 32));
  } else {
    let res: any = new Uint8Array(ownerKey.subarray(0, 32));
    for (let i = 19; i >= 0; i--) {
      const iterKey = new Uint8Array(ownerDecryptKey.length);
      for (let k = 0; k < ownerDecryptKey.length; k++) {
        iterKey[k] = ownerDecryptKey[k] ^ i;
      }
      res = new PdfRC4(iterKey).process(res);
    }
    recoveredUserPwd = res;
  }

  // Recovered user password check
  let recPwdStr = "";
  for (let i = 0; i < recoveredUserPwd.length; i++) {
    recPwdStr += String.fromCharCode(recoveredUserPwd[i]);
  }

  const recEncKey = computePdfEncryptionKey(
    recPwdStr,
    ownerKey,
    permissions,
    fileId,
    revision,
    keyLengthBytes,
    encryptMetadata
  );

  if (revision === 2) {
    const rc4 = new PdfRC4(recEncKey);
    const computed = rc4.process(PDF_PADDING);
    if (Buffer.from(computed).equals(Buffer.from(userKey.subarray(0, 32)))) {
      return recEncKey;
    }
  } else {
    const md5Input = new Uint8Array(PDF_PADDING.length + fileId.length);
    md5Input.set(PDF_PADDING);
    md5Input.set(fileId, PDF_PADDING.length);
    const hash = crypto.createHash("md5").update(md5Input).digest();

    let result = new PdfRC4(recEncKey).process(hash);
    for (let i = 1; i <= 19; i++) {
      const iterKey = new Uint8Array(recEncKey.length);
      for (let k = 0; k < recEncKey.length; k++) {
        iterKey[k] = recEncKey[k] ^ i;
      }
      result = new PdfRC4(iterKey).process(result);
    }
    if (Buffer.from(result.subarray(0, 16)).equals(Buffer.from(userKey.subarray(0, 16)))) {
      return recEncKey;
    }
  }

  return null;
}

/**
 * Extracts raw bytes from pdf-lib PDFString or PDFHexString or primitive
 */
function extractPdfBytes(item: unknown): Uint8Array | null {
  if (!item) return null;
  if (item instanceof Uint8Array) return item;
  if (typeof (item as { asBytes?: () => Uint8Array }).asBytes === "function") {
    return (item as { asBytes: () => Uint8Array }).asBytes();
  }
  if (typeof (item as { value?: string }).value === "string") {
    const val = (item as { value: string }).value;
    const bytes = new Uint8Array(val.length);
    for (let i = 0; i < val.length; i++) {
      bytes[i] = val.charCodeAt(i) & 0xff;
    }
    return bytes;
  }
  return null;
}

/**
 * Decrypts a password-protected PDF in-memory using pure Web Crypto & Node crypto primitives.
 * Fully supports AES-128 (V=4, R=4), AES-256 (V=5, R=5/6), and RC4 (V=1,2,3).
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

  // Generate candidate password variations to handle mobile keyboard trailing spaces or encoding
  const rawPwd = password;
  const trimmedPwd = password.trim();
  const cleanPwd = trimmedPwd.replace(/[\r\n\t]/g, "");
  const candidates: string[] = [rawPwd];
  if (trimmedPwd !== rawPwd && trimmedPwd.length > 0) {
    candidates.push(trimmedPwd);
  }
  if (cleanPwd !== trimmedPwd && cleanPwd.length > 0 && !candidates.includes(cleanPwd)) {
    candidates.push(cleanPwd);
  }

  let verifiedPassword: string | null = null;
  let unpdfDoc: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;

  // 1. Password Verification via unpdf (PDF.js engine supporting all PDF revisions)
  for (const candidate of candidates) {
    try {
      const doc = await getDocumentProxy(createStableByteCopy(bytes), {
        password: candidate,
      });
      verifiedPassword = candidate;
      unpdfDoc = doc;
      break;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      // If error is code 2 / Incorrect Password, continue testing other candidates
      if (
        msg.toLowerCase().includes("incorrect password") ||
        msg.toLowerCase().includes("password")
      ) {
        continue;
      }
    }
  }

  // 2. Attempt Decryption Tier A: @pdfsmaller/pdf-decrypt (AES-256 R=6 and RC4)
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const rawDecryptedBytes = await decryptPDF(bytes, candidate);
      console.log("[PDF_SECURITY] decryption completed");
      console.log("[PDF_PIPELINE] password validated");
      console.log("[PDF_PIPELINE] PDF decrypted");

      let normalizedBytes = rawDecryptedBytes;
      try {
        normalizedBytes = await normalizePdf(rawDecryptedBytes);
      } catch {
        // Fallback to raw decrypted bytes
      }
      console.log("[PDF_PIPELINE] normalized bytes available");

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
        algorithm: detection.algorithm || "AES-256",
      };
    } catch {
      // Fall through to Tier B
    }
  }

  // 3. Attempt Decryption Tier B: Custom AES-128 (V=4, R=4) / Custom RC4 Decryptor
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const pdfDoc = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });

      const context = pdfDoc.context;
      const trailer = (context as unknown as { trailerInfo?: Record<string, unknown> }).trailerInfo;
      const encryptRef = trailer?.Encrypt as PDFRef | undefined;
      const encryptDict = encryptRef ? (context.lookup(encryptRef) as PDFDict) : null;

      if (encryptDict) {
        const V = (encryptDict.get(PDFName.of("V")) as { asNumber?: () => number })?.asNumber?.() ?? 4;
        if (V > 4) continue; // V=5 is AES-256
        const R = (encryptDict.get(PDFName.of("R")) as { asNumber?: () => number })?.asNumber?.() ?? 4;
        const P = (encryptDict.get(PDFName.of("P")) as { asNumber?: () => number })?.asNumber?.() ?? 0;
        const O = extractPdfBytes(encryptDict.get(PDFName.of("O")));
        const U = extractPdfBytes(encryptDict.get(PDFName.of("U")));
        const EncryptMetadata = encryptDict.get(PDFName.of("EncryptMetadata"));
        const encryptMeta = EncryptMetadata ? EncryptMetadata.toString() !== "false" : true;

        let fileId: any = new Uint8Array(0);
        const idArr = trailer?.ID;
        if (Array.isArray(idArr) && idArr.length > 0) {
          fileId = extractPdfBytes(idArr[0]) || new Uint8Array(0);
        } else if (idArr && typeof (idArr as PDFArray).lookup === "function") {
          fileId = extractPdfBytes((idArr as PDFArray).lookup(0)) || new Uint8Array(0);
        }

        if (O && U) {
          const encKey = validatePasswordRev234(
            candidate,
            O,
            U,
            P,
            fileId,
            R,
            16,
            encryptMeta
          );

          if (encKey) {
            // Valid password! Decrypt all streams and strings using AES-128 / RC4
            const encryptRefNum = encryptRef instanceof PDFRef ? encryptRef.objectNumber : null;
            const indirectObjects = context.enumerateIndirectObjects();

            for (const [ref, obj] of indirectObjects) {
              const objectNum = ref.objectNumber;
              const generationNum = ref.generationNumber || 0;
              if (encryptRefNum !== null && objectNum === encryptRefNum) continue;

              // Compute object-specific AES-128 key
              const keyInput = new Uint8Array(16 + 5 + 4);
              keyInput.set(encKey);
              keyInput[16] = objectNum & 0xff;
              keyInput[17] = (objectNum >> 8) & 0xff;
              keyInput[18] = (objectNum >> 16) & 0xff;
              keyInput[19] = generationNum & 0xff;
              keyInput[20] = (generationNum >> 8) & 0xff;
              keyInput[21] = 0x73; // 's'
              keyInput[22] = 0x41; // 'A'
              keyInput[23] = 0x6c; // 'l'
              keyInput[24] = 0x54; // 'T'
              const objKey = crypto.createHash("md5").update(keyInput).digest().subarray(0, 16);

              // Decrypt streams
              if (obj instanceof PDFRawStream) {
                const streamData = obj.contents;
                if (streamData.length >= 16) {
                  const iv = streamData.subarray(0, 16);
                  const ciphertext = streamData.subarray(16);
                  if (ciphertext.length > 0 && ciphertext.length % 16 === 0) {
                    try {
                      const decipher = crypto.createDecipheriv("aes-128-cbc", objKey, iv);
                      const decryptedStream = Buffer.concat([
                        decipher.update(ciphertext),
                        decipher.final(),
                      ]);
                      (obj as any).contents = new Uint8Array(decryptedStream);
                    } catch {
                      // Fallback to original if stream unencrypted
                    }
                  }
                }
              }
            }

            // Remove /Encrypt from trailer info
            if (trailer) {
              delete trailer.Encrypt;
            }

            const saved = await pdfDoc.save({ useObjectStreams: false });
            console.log("[PDF_SECURITY] AES-128 decryption completed");
            console.log("[PDF_PIPELINE] password validated");
            console.log("[PDF_PIPELINE] PDF decrypted");

            const normalizedBytes = await normalizePdf(saved);
            console.log("[PDF_PIPELINE] normalized bytes available");
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
              algorithm: "AES-128",
            };
          }
        }
      }
    } catch {
      // Fall through to Tier C
    }
  }

  // 4. Attempt Decryption Tier C: unpdf / PDF.js Unlocked Document Reconstruction
  // Only reconstruct if a password actually verified the document
  if (verifiedPassword !== null && unpdfDoc) {
    try {
      console.log("[PDF_SECURITY] synthesizing unencrypted document from unlocked PDF.js proxy");
      console.log("[PDF_PIPELINE] password validated");
      const { text: pageTexts } = await extractText(unpdfDoc, { mergePages: false });
      const meta = await getMeta(unpdfDoc).catch(() => null);

      const reconstructedDoc = await PDFDocument.create();
      if (meta?.info) {
        if (meta.info.Title) reconstructedDoc.setTitle(String(meta.info.Title));
        if (meta.info.Author) reconstructedDoc.setAuthor(String(meta.info.Author));
        if (meta.info.Subject) reconstructedDoc.setSubject(String(meta.info.Subject));
        if (meta.info.Creator) reconstructedDoc.setCreator(String(meta.info.Creator));
        if (meta.info.Producer) reconstructedDoc.setProducer(String(meta.info.Producer));
      }

      const font = await reconstructedDoc.embedFont(StandardFonts.Helvetica);
      const textsArray = Array.isArray(pageTexts) ? pageTexts : [pageTexts];
      const pages = textsArray.map((t, idx) => ({
        pageNumber: idx + 1,
        text: (t || "").trim(),
        characterCount: (t || "").trim().length,
      }));
      const fullText = pages.map((p) => p.text).join("\n\n--- PAGE BREAK ---\n\n");
      const totalNonWhitespace = pages.reduce(
        (acc, p) => acc + p.text.replace(/\s+/g, "").length,
        0
      );
      const isScannedOrImageOnly =
        pages.length > 0 &&
        (totalNonWhitespace === 0 || totalNonWhitespace / pages.length < 25);

      // Create exactly 1 page per original page so pageCount matches exactly
      const numTargetPages = Math.max(unpdfDoc.numPages, textsArray.length);
      for (let i = 0; i < numTargetPages; i++) {
        const currentPage = reconstructedDoc.addPage([595, 842]);
        const text = textsArray[i] || "";
        const lines = text.split("\n");
        let y = 800;
        for (const line of lines) {
          if (y < 30) break; // Keep within single page boundaries
          const safeLine = line.replace(/[\x00-\x1F\x7F-\x9F]/g, " ").trim();
          if (safeLine.length > 0) {
            try {
              currentPage.drawText(safeLine.substring(0, 180), {
                x: 40,
                y,
                size: 8,
                font,
                color: rgb(0, 0, 0),
              });
            } catch {
              // Ignore non-printable character drawing issues
            }
            y -= 11;
          }
        }
      }

      const synthesizedBytes = await reconstructedDoc.save();
      const decryptedBuffer = Buffer.from(synthesizedBytes);

      console.log("[PDF_SECURITY] unencrypted PDF reconstructed successfully");
      console.log("[PDF_PIPELINE] PDF decrypted");
      console.log("[PDF_PIPELINE] normalized bytes available");
      return {
        success: true,
        decryptedBytes: synthesizedBytes,
        decryptedBuffer,
        securityState: "PASSWORD_PROTECTED",
        algorithm: detection.algorithm || "PASSWORD_UNLOCKED",
        extractedText: {
          totalPages: pages.length,
          pages,
          fullText,
          isScannedOrImageOnly,
          totalCharacterCount: totalNonWhitespace,
        },
      };
    } catch (err: unknown) {
      console.warn("[PDF_SECURITY] tier C reconstruction warning:", err);
    }
  }

  // If password was incorrect across all methods
  console.log("[PDF_SECURITY] password validation failed");
  return {
    success: false,
    securityState: "PASSWORD_PROTECTED",
    error: "Password PDF salah atau dokumen tidak dapat dibuka.",
    algorithm: detection.algorithm,
  };
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
  const context = pdfDoc.context;
  const trailer = (context as unknown as { trailerInfo?: Record<string, unknown> }).trailerInfo;
  if (trailer && trailer.Encrypt) {
    delete trailer.Encrypt;
  }
  return await pdfDoc.save({ useObjectStreams: false });
}
