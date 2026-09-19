import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types";
import { extractStatementPeriod, extractAccountHolderName } from "../utils";

export class MaybankDetector implements BankDetector {
  readonly bankCode = "MAYBANK";
  readonly bankName = "Maybank Indonesia";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (
      metaAuthor.includes("MAYBANK") ||
      metaCreator.includes("MAYBANK") ||
      metaAuthor.includes("BII")
    ) {
      matchedSignals.push("Maybank brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("MAYBANK INDONESIA") ||
      upperText.includes("PT BANK MAYBANK INDONESIA TBK") ||
      upperText.includes("M2U ID") ||
      upperText.includes("MAYBANK CUSTOMER CARE") ||
      upperText.includes("MAYBANK.CO.ID")
    ) {
      matchedSignals.push("Maybank Indonesia institutional brand/digital channels detected");
      score += 40;
    } else if (/\bMAYBANK\b/.test(upperText)) {
      matchedSignals.push("Maybank brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology
    if (
      upperText.includes("STATEMENT OF ACCOUNT") ||
      upperText.includes("PENYATA AKAUN") ||
      upperText.includes("REKENING KORAN")
    ) {
      matchedSignals.push("Maybank statement header detected");
      score += 15;
    }

    // 4. Account Number (typically 10 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:account\s*number|nomor\s*rekening|no\.?\s*rekening)\s*[:=]?\s*([0-9]{1}[-\s]?[0-9]{3}[-\s]?[0-9]{6}|[0-9]{10})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1].replace(/[-\s]/g, "");
      matchedSignals.push("Maybank 10-digit account number matched");
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
