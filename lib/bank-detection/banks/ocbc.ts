import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types";
import { extractStatementPeriod, extractAccountHolderName } from "../utils";

export class OcbcDetector implements BankDetector {
  readonly bankCode = "OCBC";
  readonly bankName = "OCBC Indonesia";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (
      metaAuthor.includes("OCBC") ||
      metaAuthor.includes("NISP") ||
      metaCreator.includes("OCBC")
    ) {
      matchedSignals.push("OCBC brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("OCBC INDONESIA") ||
      upperText.includes("BANK OCBC") ||
      upperText.includes("OCBC NISP") ||
      upperText.includes("PT BANK OCBC NISP TBK") ||
      upperText.includes("OCBC MOBILE") ||
      upperText.includes("ONE MOBILE") ||
      upperText.includes("TANYA OCBC") ||
      upperText.includes("OCBC.ID") ||
      upperText.includes("OCBCNISP.COM")
    ) {
      matchedSignals.push("OCBC Indonesia institutional brand/digital channels detected");
      score += 40;
    } else if (/\bOCBC\b/.test(upperText)) {
      matchedSignals.push("OCBC brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology
    if (
      upperText.includes("STATEMENT OF ACCOUNT") ||
      upperText.includes("ACCOUNT STATEMENT") ||
      upperText.includes("REKENING KORAN")
    ) {
      matchedSignals.push("OCBC statement header detected");
      score += 15;
    }

    // 4. Account Number (typically 10-12 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:account\s*no\.?|account\s*number|no\.?\s*rekening)\s*[:=]?\s*([0-9]{10,12})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1];
      matchedSignals.push("OCBC 10-12 digit account number matched");
      score += 15;
    }

    // 5. Account Holder & Period
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
