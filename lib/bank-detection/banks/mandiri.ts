import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types";
import { extractStatementPeriod, extractAccountHolderName } from "../utils";

export class MandiriDetector implements BankDetector {
  readonly bankCode = "MANDIRI";
  readonly bankName = "Bank Mandiri";

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
      metaAuthor.includes("MANDIRI") ||
      metaCreator.includes("MANDIRI") ||
      metaCreator.includes("MCM") ||
      metaTitle.includes("MANDIRI")
    ) {
      matchedSignals.push("Mandiri brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("BANK MANDIRI") ||
      upperText.includes("PT BANK MANDIRI (PERSERO) TBK") ||
      upperText.includes("LIVIN' BY MANDIRI") ||
      upperText.includes("LIVIN BY MANDIRI") ||
      upperText.includes("MANDIRI CASH MANAGEMENT") ||
      upperText.includes("KOPRA BY MANDIRI") ||
      upperText.includes("MANDIRI CALL 14000") ||
      upperText.includes("BANKMANDIRI.CO.ID")
    ) {
      matchedSignals.push("Mandiri institutional brand/digital platform detected");
      score += 40;
    } else if (/\bMANDIRI\b/.test(upperText)) {
      matchedSignals.push("Mandiri brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology
    if (
      upperText.includes("REKENING KORAN") ||
      upperText.includes("REKENING KORAN GIRO") ||
      upperText.includes("REKENING KORAN TABUNGAN") ||
      upperText.includes("ACCOUNT STATEMENT")
    ) {
      matchedSignals.push("Mandiri statement header detected");
      score += 15;
    }

    // 4. Mandiri Table Columns: TANGGAL POSTING / TANGGAL TRANSAKSI / DEBET (DR) / KREDIT (CR) / SALDO
    if (
      upperText.includes("TANGGAL POSTING") ||
      upperText.includes("TANGGAL TRANSAKSI") ||
      (upperText.includes("DEBET") && upperText.includes("KREDIT") && upperText.includes("SALDO"))
    ) {
      matchedSignals.push("Mandiri transaction layout columns matched");
      score += 15;
    }

    // 5. Account Number (Mandiri accounts are typically 13 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:no\.?\s*rekening|nomor\s*rekening|account\s*number)\s*[:=]?\s*([0-9]{3}[-\s]?[0-9]{2}[-\s]?[0-9]{7}[-\s]?[0-9]|[0-9]{13})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1].replace(/[-\s]/g, "");
      matchedSignals.push("Mandiri 13-digit account number format matched");
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
