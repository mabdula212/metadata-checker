import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types";
import { extractStatementPeriod, extractAccountHolderName } from "../utils";

export class BcaDetector implements BankDetector {
  readonly bankCode = "BCA";
  readonly bankName = "Bank Central Asia";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Check Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaTitle = (metadata?.title || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (
      metaAuthor.includes("BCA") ||
      metaAuthor.includes("BANK CENTRAL ASIA") ||
      metaCreator.includes("KLIKBCA") ||
      metaTitle.includes("BCA")
    ) {
      matchedSignals.push("BCA brand identified in PDF metadata");
      score += 35;
    }

    // 2. Bank Brand Identifiers in Text
    if (
      upperText.includes("BANK CENTRAL ASIA") ||
      upperText.includes("PT BANK CENTRAL ASIA TBK") ||
      upperText.includes("HALOBCA") ||
      upperText.includes("HALO BCA") ||
      upperText.includes("KLIKBCA") ||
      upperText.includes("M-BCA") ||
      upperText.includes("BCA.CO.ID")
    ) {
      matchedSignals.push("BCA institutional brand/contact marker detected");
      score += 40;
    } else if (/\bBCA\b/.test(upperText)) {
      matchedSignals.push("BCA brand keyword present");
      score += 20;
    }

    // 3. BCA Statement Headers & Terminology
    if (upperText.includes("REKENING KORAN") || upperText.includes("MUTASI REKENING")) {
      matchedSignals.push("Statement header 'Rekening Koran / Mutasi Rekening' detected");
      score += 15;
    }

    if (
      upperText.includes("SALDO AWAL") &&
      (upperText.includes("MUTASI CR") || upperText.includes("MUTASI DB") || upperText.includes("SALDO AKHIR"))
    ) {
      matchedSignals.push("BCA balance summary structure (Saldo Awal, Mutasi CR/DB, Saldo Akhir) detected");
      score += 20;
    }

    // 4. BCA Transaction Table Columns: TGL, KETERANGAN, CB, MUTASI, SALDO
    if (
      upperText.includes("KETERANGAN") &&
      (upperText.includes("CB") || upperText.includes("CABANG")) &&
      upperText.includes("MUTASI") &&
      upperText.includes("SALDO")
    ) {
      matchedSignals.push("BCA standard table columns (TGL, KETERANGAN, CB, MUTASI, SALDO) matched");
      score += 15;
    }

    // 5. Account Number Detection (BCA accounts are typically 10 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:no\.?\s*rekening|nomor\s*rekening|account\s*no\.?)\s*[:=]?\s*([0-9]{10})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1];
      matchedSignals.push("BCA 10-digit account number format matched");
      score += 15;
    } else {
      // Secondary check for standard 10 digit number after REKENING
      const fallbackAcc = fullText.match(/\brekening\s*[:=]?\s*([0-9]{10})\b/i);
      if (fallbackAcc && fallbackAcc[1]) {
        detectedAccountNumber = fallbackAcc[1];
        matchedSignals.push("10-digit account pattern detected");
        score += 10;
      }
    }

    // 6. Account Holder & Period
    const detectedAccountHolder = extractAccountHolderName(fullText);
    const period = extractStatementPeriod(fullText);
    if (period.signal) {
      matchedSignals.push(period.signal);
    }

    // Determine Confidence
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
