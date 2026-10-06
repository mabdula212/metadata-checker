import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types.js";
import { extractStatementPeriod, extractAccountHolderName } from "../utils.js";

export class DanamonDetector implements BankDetector {
  readonly bankCode = "DANAMON";
  readonly bankName = "Bank Danamon";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (metaAuthor.includes("DANAMON") || metaCreator.includes("DANAMON")) {
      matchedSignals.push("Bank Danamon brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("BANK DANAMON") ||
      upperText.includes("PT BANK DANAMON INDONESIA TBK") ||
      upperText.includes("D-BANK PRO") ||
      upperText.includes("HELLO DANAMON") ||
      upperText.includes("DANAMON.CO.ID")
    ) {
      matchedSignals.push("Bank Danamon institutional brand/contact marker detected");
      score += 40;
    } else if (/\bDANAMON\b/.test(upperText)) {
      matchedSignals.push("Danamon brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology
    if (
      upperText.includes("REKENING KORAN") ||
      upperText.includes("ACCOUNT STATEMENT") ||
      upperText.includes("LAPORAN REKENING")
    ) {
      matchedSignals.push("Danamon statement header detected");
      score += 15;
    }

    // 4. Account Number (typically 10-12 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:nomor\s*rekening|no\.?\s*rekening|account\s*number)\s*[:=]?\s*([0-9]{10,12})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1];
      matchedSignals.push("Danamon 10-12 digit account number matched");
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
