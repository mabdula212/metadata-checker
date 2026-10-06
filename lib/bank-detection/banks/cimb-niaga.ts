import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types.js";
import { extractStatementPeriod, extractAccountHolderName } from "../utils.js";

export class CimbNiagaDetector implements BankDetector {
  readonly bankCode = "CIMB";
  readonly bankName = "CIMB Niaga";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata Check
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();

    if (
      metaAuthor.includes("CIMB") ||
      metaAuthor.includes("NIAGA") ||
      metaCreator.includes("CIMB")
    ) {
      matchedSignals.push("CIMB Niaga brand identified in PDF metadata");
      score += 35;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("BANK CIMB NIAGA") ||
      upperText.includes("PT BANK CIMB NIAGA TBK") ||
      upperText.includes("CIMB NIAGA") ||
      upperText.includes("OCTO MOBILE") ||
      upperText.includes("OCTO CLICKS") ||
      upperText.includes("BIZCHANNEL@CIMB") ||
      upperText.includes("CIMBNIAGA.CO.ID")
    ) {
      matchedSignals.push("CIMB Niaga institutional brand/digital channels detected");
      score += 40;
    } else if (/\bCIMB\b/.test(upperText)) {
      matchedSignals.push("CIMB brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology (Dual language Indonesian & English)
    if (
      upperText.includes("STATEMENT OF ACCOUNT") ||
      upperText.includes("PENYATA AKAUN") ||
      upperText.includes("REKENING KORAN")
    ) {
      matchedSignals.push("CIMB Statement header format detected");
      score += 15;
    }

    // 4. Columns & Terminology (DATE / TGL, DESCRIPTION / KETERANGAN, REF NO, DEBIT, CREDIT, BALANCE)
    if (
      (upperText.includes("DESCRIPTION") || upperText.includes("KETERANGAN")) &&
      (upperText.includes("REF NO") || upperText.includes("NO. REF")) &&
      (upperText.includes("BALANCE") || upperText.includes("SALDO"))
    ) {
      matchedSignals.push("CIMB dual-language table columns matched");
      score += 15;
    }

    // 5. Account Number (CIMB accounts are typically 12-14 digits)
    let detectedAccountNumber: string | null = null;
    const accMatch = fullText.match(
      /(?:account\s*number|no\.?\s*rekening|account\s*no\.?)\s*[:=]?\s*([0-9]{12,14})\b/i
    );
    if (accMatch && accMatch[1]) {
      detectedAccountNumber = accMatch[1];
      matchedSignals.push("CIMB 12-14 digit account number format matched");
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
