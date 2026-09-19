import { extractText, getDocumentProxy } from "unpdf";

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
 * Extracts textual content from a PDF buffer, preserving page boundaries.
 * Detects whether the PDF is likely scanned or image-only (zero or negligible selectable text).
 */
export async function extractPdfText(
  pdfBuffer: Buffer | Uint8Array
): Promise<PdfTextExtractionResult> {
  try {
    const uint8Array = Buffer.isBuffer(pdfBuffer)
      ? new Uint8Array(pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength))
      : pdfBuffer instanceof Uint8Array
      ? pdfBuffer
      : new Uint8Array(pdfBuffer);

    // Load PDF document using unpdf (pure JS, safe in Node & serverless runtimes)
    const pdf = await getDocumentProxy(uint8Array);
    const numPages = pdf.numPages;

    // Extract text per page without merging
    const { totalPages, text: pageTexts } = await extractText(pdf, {
      mergePages: false,
    });

    const pages: ExtractedPdfPage[] = [];
    let fullText = "";
    let totalNonWhitespaceChars = 0;

    const textsArray = Array.isArray(pageTexts) ? pageTexts : [pageTexts];

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
