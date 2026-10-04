export interface DocumentRecord {
  id: string;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  status: "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED";
  documentType: "UNKNOWN" | "BANK_STATEMENT" | "OTHER_PDF";
  createdAt: string;
  updatedAt: string;
}

export interface DocumentMetadataRecord {
  id: string;
  documentId: string;
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  pageCount: number | null;
  fileHash: string | null;
  rawMetadataJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingJobRecord {
  id: string;
  documentId: string;
  jobType: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  errorMessage: string | null;
}

export interface BankDetectionCandidateUi {
  bankCode: string;
  bankName: string;
  score: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  signalsCount: number;
}

export interface BankDetectionResultUi {
  documentType: "BANK_STATEMENT" | "OTHER_PDF" | "UNKNOWN";
  bankCode: string | null;
  bankName: string | null;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  matchedSignals: string[];
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  accountNumberMasked: string | null;
  accountHolderName: string | null;
  productName?: string | null;
  businessUnit?: string | null;
  currency?: string | null;
  isScannedOrImageOnly: boolean;
  warning?: string | null;
  notDetectedReason?: string | null;
  advancedDetails?: {
    totalCharacterCount: number;
    totalPages: number;
    allCandidates: BankDetectionCandidateUi[];
    generalStatementSignals: string[];
  };
}

export interface BankDetectionApiResponse {
  success: boolean;
  error?: string;
  document?: DocumentRecord;
  detection?: BankDetectionResultUi;
  bankAccount?: {
    id: string;
    bankName: string;
    accountNumberMasked: string;
    accountHolderName: string;
  } | null;
  statement?: {
    id: string;
    bankName: string;
    accountNumberMasked: string | null;
    accountHolderName: string | null;
    statementPeriodStart: string | null;
    statementPeriodEnd: string | null;
  } | null;
  job?: ProcessingJobRecord;
}

export interface InspectApiResponse {
  success: boolean;
  isDuplicate?: boolean;
  requiresPassword?: boolean;
  passwordRequired?: boolean;
  securityState?: string;
  algorithm?: string;
  message?: string;
  error?: string;
  executionPlan?: string[];
  engineResults?: {
    metadata?: {
      status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
      pageCount?: number | null;
    };
    bankDetection?: {
      status: "SUCCESS" | "FAILED" | "SKIPPED";
      bank?: string | null;
      bankName?: string | null;
    };
    transactionExtraction?: {
      status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
      transactionCount?: number;
      needsReview?: number;
    };
    validation?: {
      status: "SUCCESS" | "FAILED" | "SKIPPED";
      balanceReconciliationStatus?: string | null;
    };
    excelExport?: {
      status: "SUCCESS" | "FAILED" | "SKIPPED";
    };
  };
  data?: {
    document: DocumentRecord;
    metadata: DocumentMetadataRecord | null;
    job?: ProcessingJobRecord;
    detection?: BankDetectionResultUi | null;
    statement?: any;
    extraction?: any;
  };
}

export interface RecentDocumentItem extends DocumentRecord {
  metadata?: DocumentMetadataRecord | null;
  statement?: {
    bankName: string;
    accountNumberMasked: string | null;
    accountHolderName: string | null;
    statementPeriodStart: string | null;
    statementPeriodEnd: string | null;
  } | null;
}
