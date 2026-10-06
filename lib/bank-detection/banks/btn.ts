import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types.js";
import { extractStatementPeriod, extractAccountHolderName } from "../utils.js";

export class BtnDetector implements BankDetector {
  readonly bankCode = "BTN";
  readonly bankName = "Bank Tabungan Negara";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (
      metaAuthor.includes("BANK TABUNGAN NEGARA") ||
      metaAuthor.includes("BTN") ||
      metaCreator.includes("BTN")
    ) {
      matchedSignals.push("Bank BTN brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("BANK TABUNGAN NEGARA") ||
      upperText.includes("PT BANK TABUNGAN NEGARA") ||
      upperText.includes("BANK BTN") ||
      upperText.includes("BTN MOBILE") ||
      upperText.includes("BALE BY BTN") ||
      upperText.includes("BTN.CO.ID")
    ) {
      matchedSignals.push("BTN institutional brand/digital channels detected");
      score += 40;
    } else if (/\bBTN\b/.test(upperText)) {
      matchedSignals.push("BTN brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology
    if (upperText.includes("REKENING KORAN") || upperText.includes("E-STATEMENT BTN")) {
      matchedSignals.push("BTN statement header detected");
      score += 15;
    }

    // 4. Account Number (typically 16 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:no\.?\s*rekening|nomor\s*rekening|no\.?\s*rek)\s*[:=]?\s*([0-9]{4,6}[-\s]?[0-9]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{6}[-\s]?[0-9]|[0-9]{16})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1].replace(/[-\s]/g, "");
      matchedSignals.push("BTN 16-digit account number format matched");
      score += 20;
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
