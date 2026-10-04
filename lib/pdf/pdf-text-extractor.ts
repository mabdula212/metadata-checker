import { getDocumentProxy } from "unpdf";
import { createStableByteCopy } from "./pdf-inspector.js";
import { getDecryptedExtractedText } from "./pdf-decryptor.js";

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
  characterCount: number;
}

export interface PdfTextExtractionResult {
  totalPages: number;
  pages: ExtractedPdfPage[];
  fullText: string;
  isScannedOrImageOnly: boolean;
  totalCharacterCount: number;
  warning?: string;
}

/**
 * Extracts text from a PDF.js page proxy while preserving both line breaks (Y-coordinate jumps)
 * and column spacing (X-coordinate gaps between adjacent text items on the same row).
 */
export async function extractPageTextFromProxy(page: {
  getTextContent: () => Promise<{ items?: Array<Record<string, unknown>> }>;
}): Promise<string> {
  const content = await page.getTextContent();
  const rawItems = (content?.items || []).filter(
    (item) => item && typeof item.str === "string"
  );
  if (rawItems.length === 0) return "";

  let out = "";
  let prevX: number | null = null;
  let prevY: number | null = null;
  let prevWidth = 0;

  for (const item of rawItems) {
    const str = item.str as string;
    const transform = Array.isArray(item.transform) ? item.transform : null;
    const x = transform && transform.length >= 6 ? Number(transform[4]) : null;
    const y = transform && transform.length >= 6 ? Number(transform[5]) : null;
    const width = typeof item.width === "number" ? item.width : 0;

    if (str.length > 0 && prevY !== null && y !== null) {
      const yDiff = Math.abs(y - prevY);
      if (yDiff > 3) {
        if (!out.endsWith("\n")) {
          out += "\n";
        }
      } else if (prevX !== null && x !== null) {
        const expectedNextX = prevX + prevWidth;
        const xGap = x - expectedNextX;
        if (
          (xGap > 1.5 || (prevWidth === 0 && Math.abs(x - prevX) > 6)) &&
          !out.endsWith(" ") &&
          !out.endsWith("\n") &&
          !str.startsWith(" ")
        ) {
          out += " ";
        }
      }
    }

    out += str;
    if (item.hasEOL && !out.endsWith("\n")) {
      out += "\n";
    }

    if (str.trim().length > 0) {
      prevX = x;
      prevY = y;
      prevWidth = width;
    }
  }

  return out;
}

/**
 * Extracts textual content from a PDF buffer, preserving page boundaries.
 * Detects whether the PDF is likely scanned or image-only (zero or negligible selectable text).
 */
export async function extractPdfText(
  pdfBuffer: Buffer | Uint8Array,
  options?: {
    documentId?: string;
    password?: string | null;
  }
): Promise<PdfTextExtractionResult> {
  // Check if high-fidelity text was already extracted during decryption
  if (options?.documentId) {
    const cachedText = getDecryptedExtractedText(options.documentId);
    if (cachedText) {
      return cachedText;
    }
  }

  try {
    // Always create an isolated, dedicated Uint8Array copy so unpdf cannot detach caller's buffer
    const uint8Array = createStableByteCopy(pdfBuffer);

    // Load PDF document using unpdf (pure JS, safe in Node & serverless runtimes)
    const pdf = await getDocumentProxy(
      uint8Array,
      options?.password ? { password: options.password } : undefined
    );
    const numPages = pdf.numPages;

    const textsArray: string[] = [];
    for (let p = 1; p <= numPages; p++) {
      const page = await pdf.getPage(p);
      const pageText = await extractPageTextFromProxy(page);
      textsArray.push(pageText);
    }
    const totalPages = numPages;

    const pages: ExtractedPdfPage[] = [];
    let fullText = "";
    let totalNonWhitespaceChars = 0;

    for (let i = 0; i < textsArray.length; i++) {
      const pageNum = i + 1;
      const rawPageText = textsArray[i] || "";
      const trimmedText = rawPageText.trim();
      const nonWhitespaceCount = trimmedText.replace(/\s+/g, "").length;

      totalNonWhitespaceChars += nonWhitespaceCount;
      pages.push({
        pageNumber: pageNum,
        text: trimmedText,
        characterCount: trimmedText.length,
      });

      fullText += (fullText ? "\n\n--- PAGE BREAK ---\n\n" : "") + trimmedText;
    }

    // Determine if document is scanned or image-only:
    // If average non-whitespace characters per page is below 25, or total is below 30
    const isScannedOrImageOnly =
      totalPages > 0 &&
      (totalNonWhitespaceChars === 0 ||
        totalNonWhitespaceChars / Math.max(totalPages, 1) < 25);

    let warning: string | undefined;
    if (isScannedOrImageOnly) {
      warning =
        "This PDF appears to contain scanned images rather than selectable text. Transaction extraction may require OCR.";
    }

    return {
      totalPages: totalPages || numPages,
      pages,
      fullText,
      isScannedOrImageOnly,
      totalCharacterCount: totalNonWhitespaceChars,
      warning,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to extract text from PDF";

    // Handle password protected / encrypted PDFs
    if (
      message.toLowerCase().includes("password") ||
      message.toLowerCase().includes("encrypted")
    ) {
      throw new Error("The PDF document is password-protected or encrypted.");
    }

    throw new Error(`PDF text extraction error: ${message}`);
  }
}
