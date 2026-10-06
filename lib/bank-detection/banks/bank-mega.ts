import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types.js";
import { extractStatementPeriod, extractAccountHolderName } from "../utils.js";

export class BankMegaDetector implements BankDetector {
  readonly bankCode = "MEGA";
  readonly bankName = "Bank Mega";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (metaAuthor.includes("BANK MEGA") || metaCreator.includes("BANK MEGA")) {
      matchedSignals.push("Bank Mega brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("BANK MEGA") ||
      upperText.includes("PT BANK MEGA TBK") ||
      upperText.includes("M-SMILE") ||
      upperText.includes("MEGA CALL") ||
      upperText.includes("BANKMEGA.COM")
    ) {
      matchedSignals.push("Bank Mega institutional brand/digital channels detected");
      score += 40;
    } else if (/\bMEGA\b/.test(upperText) && upperText.includes("BANK")) {
      matchedSignals.push("Bank Mega keyword combination present");
      score += 20;
    }

    // 3. Statement Terminology
    if (upperText.includes("REKENING KORAN") || upperText.includes("STATEMENT OF ACCOUNT")) {
      matchedSignals.push("Bank Mega statement header detected");
      score += 15;
    }

    // 4. Account Number (typically 10-12 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:no\.?\s*rekening|nomor\s*rekening|account\s*no\.?)\s*[:=]?\s*([0-9]{10,12})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1];
      matchedSignals.push("Bank Mega 10-12 digit account number matched");
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
