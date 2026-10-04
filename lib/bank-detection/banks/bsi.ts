import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types.js";
import { extractStatementPeriod, extractAccountHolderName } from "../utils.js";

export class BsiDetector implements BankDetector {
  readonly bankCode = "BSI";
  readonly bankName = "Bank Syariah Indonesia";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (
      metaAuthor.includes("SYARIAH INDONESIA") ||
      metaAuthor.includes("BSI") ||
      metaCreator.includes("BSI")
    ) {
      matchedSignals.push("BSI brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("BANK SYARIAH INDONESIA") ||
      upperText.includes("PT BANK SYARIAH INDONESIA TBK") ||
      upperText.includes("BSI MOBILE") ||
      upperText.includes("BYOND BY BSI") ||
      upperText.includes("BSI CALL 14040") ||
      upperText.includes("BANKBSI.CO.ID")
    ) {
      matchedSignals.push("BSI institutional brand/digital platform detected");
      score += 40;
    } else if (/\bBSI\b/.test(upperText)) {
      matchedSignals.push("BSI brand keyword present");
      score += 20;
    }

    // 3. Sharia Banking Terminology
    if (
      upperText.includes("WADIAH") ||
      upperText.includes("MUDHARABAH") ||
      upperText.includes("NISBAH") ||
      upperText.includes("BAGI HASIL") ||
      upperText.includes("BONUS WADIAH")
    ) {
      matchedSignals.push("Islamic banking contract terms (Wadiah / Mudharabah / Bagi Hasil) detected");
      score += 20;
    }

    // 4. Statement Terminology
    if (
      upperText.includes("REKENING KORAN") ||
      upperText.includes("MUTASI TRANSAKSI") ||
      upperText.includes("E-STATEMENT BSI")
    ) {
      matchedSignals.push("BSI statement header detected");
      score += 15;
    }

    // 5. Account Number (typically 10 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:nomor\s*rekening|no\.?\s*rekening|no\.?\s*rek)\s*[:=]?\s*([0-9]{10})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1];
      matchedSignals.push("BSI 10-digit account number matched");
      score += 15;
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
