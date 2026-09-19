import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types";
import { extractStatementPeriod, extractAccountHolderName } from "../utils";

export class PermataDetector implements BankDetector {
  readonly bankCode = "PERMATA";
  readonly bankName = "PermataBank";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (
      metaAuthor.includes("PERMATA") ||
      metaAuthor.includes("BANK PERMATA") ||
      metaCreator.includes("PERMATA")
    ) {
      matchedSignals.push("PermataBank identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("PERMATABANK") ||
      upperText.includes("PT BANK PERMATA TBK") ||
      upperText.includes("BANK PERMATA") ||
      upperText.includes("PERMATAMOBILE") ||
      upperText.includes("PERMATAMOBILE X") ||
      upperText.includes("PERMATANET") ||
      upperText.includes("PERMATATEL") ||
      upperText.includes("PERMATABANK.COM")
    ) {
      matchedSignals.push("PermataBank institutional brand/digital channels detected");
      score += 40;
    } else if (/\bPERMATA\b/.test(upperText)) {
      matchedSignals.push("Permata brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology
    if (
      upperText.includes("E-STATEMENT") ||
      upperText.includes("REKENING KORAN") ||
      upperText.includes("ACCOUNT STATEMENT")
    ) {
      matchedSignals.push("Permata statement header format detected");
      score += 15;
    }

    // 4. Account Number (typically 10-12 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:no\.?\s*rekening|nomor\s*rekening|acc\s*number)\s*[:=]?\s*([0-9]{10,12})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1];
      matchedSignals.push("Permata 10-12 digit account number matched");
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
