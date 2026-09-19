import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types";
import { extractStatementPeriod, extractAccountHolderName } from "../utils";

export class BniDetector implements BankDetector {
  readonly bankCode = "BNI";
  readonly bankName = "Bank Negara Indonesia";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaTitle = (metadata?.title || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (
      metaAuthor.includes("BANK NEGARA INDONESIA") ||
      metaAuthor.includes("BNI") ||
      metaCreator.includes("BNI") ||
      metaTitle.includes("BNI")
    ) {
      matchedSignals.push("BNI brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("BANK NEGARA INDONESIA") ||
      upperText.includes("PT BANK NEGARA INDONESIA") ||
      upperText.includes("BNIDIRECT") ||
      upperText.includes("WONDR BY BNI") ||
      upperText.includes("BNI CALL 1500046") ||
      upperText.includes("BNI.CO.ID")
    ) {
      matchedSignals.push("BNI institutional brand/digital platform detected");
      score += 40;
    } else if (/\bBNI\b/.test(upperText)) {
      matchedSignals.push("BNI brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology
    if (
      upperText.includes("REKENING KORAN") ||
      upperText.includes("ELECTRONIC STATEMENT") ||
      upperText.includes("MUTASI REKENING")
    ) {
      matchedSignals.push("BNI statement header detected");
      score += 15;
    }

    // 4. BNI Table Structure (TANGGAL, JAM, URAIAN TRANSAKSI, DEBET, KREDIT, SALDO)
    if (
      upperText.includes("URAIAN TRANSAKSI") ||
      (upperText.includes("TANGGAL") && upperText.includes("CABANG") && upperText.includes("SALDO"))
    ) {
      matchedSignals.push("BNI statement table columns matched");
      score += 15;
    }

    // 5. Account Number (BNI accounts are typically 10 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:no\.?\s*rekening|nomor\s*rekening|account\s*no\.?)\s*[:=]?\s*([0-9]{10})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1];
      matchedSignals.push("BNI 10-digit account number format matched");
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
