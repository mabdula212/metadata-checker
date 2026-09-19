import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types";
import { extractStatementPeriod, extractAccountHolderName } from "../utils";

export class BriDetector implements BankDetector {
  readonly bankCode = "BRI";
  readonly bankName = "Bank Rakyat Indonesia";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata Check
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();
    const metaTitle = (metadata?.title || "").toUpperCase();

    if (
      metaAuthor.includes("BANK RAKYAT INDONESIA") ||
      metaAuthor.includes("BRI") ||
      metaCreator.includes("BRIMO") ||
      metaTitle.includes("BRI")
    ) {
      matchedSignals.push("BRI brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("BANK RAKYAT INDONESIA") ||
      upperText.includes("PT BANK RAKYAT INDONESIA") ||
      upperText.includes("CALL BRI 14017") ||
      upperText.includes("BRIMO") ||
      upperText.includes("BRI.CO.ID")
    ) {
      matchedSignals.push("BRI institutional brand/contact marker detected");
      score += 40;
    } else if (/\bBRI\b/.test(upperText)) {
      matchedSignals.push("BRI brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology
    if (upperText.includes("REKENING KORAN") || upperText.includes("TRANSAKSI REKENING KORAN")) {
      matchedSignals.push("Statement header 'Rekening Koran' detected");
      score += 15;
    }

    // 4. BRI Specific Columns & Terminology
    if (
      upperText.includes("URAIAN TRANSAKSI") ||
      upperText.includes("CHQ/NO REF") ||
      upperText.includes("TELLER ID")
    ) {
      matchedSignals.push("BRI distinctive table fields (Uraian Transaksi, CHQ/No Ref, Teller ID) detected");
      score += 20;
    }

    if (upperText.includes("TOTAL DEBET") || upperText.includes("TOTAL KREDIT")) {
      matchedSignals.push("BRI summary indicators (Total Debet, Total Kredit) detected");
      score += 15;
    }

    // 5. Account Number (BRI accounts are typically 15 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:no\.?\s*rekening|nomor\s*rekening|no\.?\s*rek)\s*[:=]?\s*([0-9]{4}[-\s]?[0-9]{2}[-\s]?[0-9]{6}[-\s]?[0-9]{2}[-\s]?[0-9]|[0-9]{15})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1].replace(/[-\s]/g, "");
      matchedSignals.push("BRI 15-digit account number format matched");
      score += 20;
    }

    // 6. Account Holder & Period
    const detectedAccountHolder = extractAccountHolderName(fullText);
    const period = extractStatementPeriod(fullText);
    if (period.signal) {
      matchedSignals.push(period.signal);
    }

    let confidence: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    if (score >= 60) {
      confidence = "HIGH";
    } else if (score >= 35) {
      confidence = "MEDIUM";
    }

    return {
      bankCode: this.bankCode,
      bankName: this.bankName,
      matchedSignals,
      score,
      confidence,
      detectedAccountNumber,
      detectedAccountHolder,
      detectedPeriodStart: period.start,
      detectedPeriodEnd: period.end,
    };
  }
}
