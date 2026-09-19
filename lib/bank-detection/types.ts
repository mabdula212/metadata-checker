import type { ExtractedPdfPage } from "../pdf/pdf-text-extractor";

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export type DocumentClassification = "BANK_STATEMENT" | "OTHER_PDF" | "UNKNOWN";

export interface BankDetectionInput {
  fullText: string;
  pages: ExtractedPdfPage[];
  metadata?: {
    title?: string | null;
    author?: string | null;
    creator?: string | null;
    producer?: string | null;
    subject?: string | null;
  };
}

export interface BankDetectionCandidate {
  bankCode: string;
  bankName: string;
  matchedSignals: string[];
  score: number;
  confidence: ConfidenceLevel;
  detectedAccountNumber?: string | null;
  detectedAccountHolder?: string | null;
  detectedPeriodStart?: string | null;
  detectedPeriodEnd?: string | null;
}

export interface BankDetector {
  readonly bankCode: string;
  readonly bankName: string;
  detect(input: BankDetectionInput): BankDetectionCandidate;
}

export interface BankDetectionResult {
  documentType: DocumentClassification;
  bankCode: string | null;
  bankName: string | null;
  confidence: ConfidenceLevel;
  matchedSignals: string[];
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  accountNumberMasked: string | null;
  accountHolderName: string | null;
  isScannedOrImageOnly: boolean;
  warning?: string | null;
  notDetectedReason?: string | null;
  advancedDetails?: {
    totalCharacterCount: number;
    totalPages: number;
    allCandidates: Array<{
      bankCode: string;
      bankName: string;
      score: number;
      confidence: ConfidenceLevel;
      signalsCount: number;
    }>;
    generalStatementSignals: string[];
  };
}
