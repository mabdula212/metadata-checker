import type {
  BankDetector,
  BankDetectionInput,
  BankDetectionResult,
  BankDetectionCandidate,
  DocumentClassification,
  ConfidenceLevel,
} from "./types.js";
import {
  maskAccountNumber,
  extractStatementPeriod,
  extractAccountHolderName,
  detectGeneralStatementSignals,
} from "./utils.js";
import type { PdfTextExtractionResult } from "../pdf/pdf-text-extractor.js";

// Bank Detectors
import { BcaDetector } from "./banks/bca.js";
import { BriDetector } from "./banks/bri.js";
import { MandiriDetector } from "./banks/mandiri.js";
import { BniDetector } from "./banks/bni.js";
import { CimbNiagaDetector } from "./banks/cimb-niaga.js";
import { DanamonDetector } from "./banks/danamon.js";
import { PermataDetector } from "./banks/permata.js";
import { BankMegaDetector } from "./banks/bank-mega.js";
import { BtnDetector } from "./banks/btn.js";
import { OcbcDetector } from "./banks/ocbc.js";
import { MaybankDetector } from "./banks/maybank.js";
import { BsiDetector } from "./banks/bsi.js";

/**
 * Registry of supported bank statement detectors.
 * Modular design makes it easy to register additional banks.
 */
export const DEFAULT_BANK_DETECTORS: BankDetector[] = [
  new BcaDetector(),
  new BriDetector(),
  new MandiriDetector(),
  new BniDetector(),
  new CimbNiagaDetector(),
  new DanamonDetector(),
  new PermataDetector(),
  new BankMegaDetector(),
  new BtnDetector(),
  new OcbcDetector(),
  new MaybankDetector(),
  new BsiDetector(),
];

export interface BankDetectionEngineOptions {
  detectors?: BankDetector[];
}

/**
 * Primary Bank Statement Detection Engine.
 * Evaluates PDF text, structure, metadata, and bank-specific rules.
 */
export class BankDetectionEngine {
  private detectors: BankDetector[];

  constructor(options: BankDetectionEngineOptions = {}) {
    this.detectors = options.detectors || DEFAULT_BANK_DETECTORS;
  }

  /**
   * Register a new bank detector at runtime.
   */
  registerDetector(detector: BankDetector): void {
    this.detectors.push(detector);
  }

  /**
   * Analyzes an extracted PDF document to determine if it is a bank statement,
   * which bank it belongs to, its statement period, and masked account details.
   */
  detect(
    extractionResult: PdfTextExtractionResult,
    metadata?: BankDetectionInput["metadata"]
  ): BankDetectionResult {
    const { fullText, pages, isScannedOrImageOnly, warning } = extractionResult;

    // Handle Scanned / Image-Only PDFs
    if (isScannedOrImageOnly) {
      return {
        documentType: "UNKNOWN",
        bankCode: null,
        bankName: null,
        confidence: "LOW",
        matchedSignals: [],
        statementPeriodStart: null,
        statementPeriodEnd: null,
        accountNumberMasked: null,
        accountHolderName: null,
        isScannedOrImageOnly: true,
        warning:
          warning ||
          "This PDF appears to contain scanned images rather than selectable text. Transaction extraction may require OCR.",
        notDetectedReason: "Scanned image PDF without selectable text.",
        advancedDetails: {
          totalCharacterCount: extractionResult.totalCharacterCount,
          totalPages: extractionResult.totalPages,
          allCandidates: [],
          generalStatementSignals: [],
        },
      };
    }

    const input: BankDetectionInput = {
      fullText,
      pages,
      metadata,
    };

    // 1. General bank statement terminology detection
    const generalSignals = detectGeneralStatementSignals(fullText);
    const globalPeriod = extractStatementPeriod(fullText);
    const globalHolder = extractAccountHolderName(fullText);

    // Generic account number fallback
    const genericAccMatch = fullText.match(
      /(?:no\.?\s*rekening|nomor\s*rekening|account\s*no\.?|account\s*number)\s*[:=]?\s*([0-9]{8,18})\b/i
    );
    const genericAccNumber = genericAccMatch ? genericAccMatch[1] : null;

    // 2. Evaluate each registered bank detector
    const candidates: BankDetectionCandidate[] = this.detectors.map((d) =>
      d.detect(input)
    );

    // Sort candidates by score descending
    candidates.sort((a, b) => b.score - a.score);

    const topCandidate = candidates[0];
    const secondCandidate = candidates[1];

    // Check for Ambiguous Bank Text
    const isAmbiguous =
      topCandidate &&
      secondCandidate &&
      topCandidate.score >= 35 &&
      secondCandidate.score >= 35 &&
      Math.abs(topCandidate.score - secondCandidate.score) <= 5 &&
      topCandidate.bankCode !== secondCandidate.bankCode;

    // 3. Determine Document Classification & Bank
    let documentType: DocumentClassification = "UNKNOWN";
    let bankCode: string | null = null;
    let bankName: string | null = null;
    let confidence: ConfidenceLevel = "LOW";
    let matchedSignals: string[] = [];
    let notDetectedReason: string | null = null;

    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    let rawAccountNumber: string | null = null;
    let accountHolder: string | null = null;

    if (isAmbiguous) {
      documentType = "BANK_STATEMENT";
      confidence = "LOW";
      notDetectedReason = `Ambiguous bank identification: Similar evidence found for ${topCandidate.bankName} and ${secondCandidate.bankName}.`;
      matchedSignals = [
        ...topCandidate.matchedSignals,
        ...secondCandidate.matchedSignals,
        ...generalSignals,
      ];
      periodStart = globalPeriod.start;
      periodEnd = globalPeriod.end;
      rawAccountNumber = genericAccNumber;
      accountHolder = globalHolder;
    } else if (topCandidate && topCandidate.score >= 35) {
      // Confident Bank Match
      documentType = "BANK_STATEMENT";
      bankCode = topCandidate.bankCode;
      bankName = topCandidate.bankName;
      confidence = topCandidate.confidence;

      // Combine bank signals with general statement signals
      matchedSignals = Array.from(
        new Set([...topCandidate.matchedSignals, ...generalSignals])
      );

      periodStart = topCandidate.detectedPeriodStart || globalPeriod.start;
      periodEnd = topCandidate.detectedPeriodEnd || globalPeriod.end;
      rawAccountNumber = topCandidate.detectedAccountNumber || genericAccNumber;
      accountHolder = topCandidate.detectedAccountHolder || globalHolder;
    } else if (generalSignals.length >= 2) {
      // General bank statement detected, but specific bank unrecognized
      documentType = "BANK_STATEMENT";
      bankCode = null;
      bankName = null;
      confidence = "LOW";
      notDetectedReason = "Insufficient bank-specific evidence.";
      matchedSignals = [...generalSignals];
      if (globalPeriod.signal) matchedSignals.push(globalPeriod.signal);

      periodStart = globalPeriod.start;
      periodEnd = globalPeriod.end;
      rawAccountNumber = genericAccNumber;
      accountHolder = globalHolder;
    } else {
      // Check if this is clearly a non-financial PDF or unknown
      const upper = fullText.toUpperCase();
      const nonFinancialKeywords = [
        "INVOICE",
        "FAKTUR",
        "KWITANSI",
        "RECEIPT",
        "SURAT PERJANJIAN",
        "AGREEMENT",
        "KONTRAK",
        "CURRICULUM VITAE",
        "RESUME",
        "PROPOSAL",
        "LAPORAN KEUANGAN",
        "ANNUAL REPORT",
        "SURAT TUGAS",
        "EDUCATION",
        "EXPERIENCE",
        "SERTIFIKAT",
        "CERTIFICATE",
      ];

      const hasNonFinancialKeyword = nonFinancialKeywords.some((kw) =>
        upper.includes(kw)
      );

      // If text has general document structure (>150 non-whitespace chars) and zero bank statement signals
      if (
        hasNonFinancialKeyword ||
        (extractionResult.totalCharacterCount >= 150 && generalSignals.length === 0)
      ) {
        documentType = "OTHER_PDF";
        notDetectedReason =
          "Document does not contain bank statement characteristics.";
      } else {
        documentType = "UNKNOWN";
        notDetectedReason =
          "Insufficient financial and bank statement evidence.";
      }
    }

    return {
      documentType,
      bankCode,
      bankName,
      confidence,
      matchedSignals,
      statementPeriodStart: periodStart,
      statementPeriodEnd: periodEnd,
      accountNumberMasked: maskAccountNumber(rawAccountNumber),
      accountHolderName: accountHolder,
      isScannedOrImageOnly: false,
      warning: null,
      notDetectedReason,
      advancedDetails: {
        totalCharacterCount: extractionResult.totalCharacterCount,
        totalPages: extractionResult.totalPages,
        allCandidates: candidates.map((c) => ({
          bankCode: c.bankCode,
          bankName: c.bankName,
          score: c.score,
          confidence: c.confidence,
          signalsCount: c.matchedSignals.length,
        })),
        generalStatementSignals: generalSignals,
      },
    };
  }
}

/**
 * Singleton instance of the engine for default usage.
 */
export const defaultBankDetectionEngine = new BankDetectionEngine();
